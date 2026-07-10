#include "apiclient.h"

#include <QNetworkRequest>
#include <QNetworkReply>
#include <QHttpMultiPart>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QDebug>
#include <QTimer>
#include <QRegularExpression>
#include <QAbstractSocket>

ApiClient::ApiClient(QObject *parent)
    : QObject(parent)
{
    m_networkManager = new QNetworkAccessManager(this);
    m_eventManager = new QNetworkAccessManager(this);
    
    // Try to find backend port from environment or default
    QString port = qEnvironmentVariable("PORT", "0");
    if (port == "0") {
        // Try common ports
        m_baseUrl = "http://127.0.0.1:3000";
    } else {
        m_baseUrl = QString("http://127.0.0.1:%1").arg(port);
    }
    
    // Reconnection timer
    m_reconnectTimer = new QTimer(this);
    m_reconnectTimer->setInterval(5000);
    connect(m_reconnectTimer, &QTimer::timeout, this, &ApiClient::startEventSource);
    
    // Ping timer to keep connection alive
    m_pingTimer = new QTimer(this);
    m_pingTimer->setInterval(30000);
    connect(m_pingTimer, &QTimer::timeout, this, &ApiClient::checkConnection);
}

ApiClient::~ApiClient()
{
    if (m_eventReply) {
        m_eventReply->abort();
        m_eventReply->deleteLater();
    }
}

void ApiClient::setBaseUrl(const QString &url)
{
    m_baseUrl = url;
}

void ApiClient::checkConnection()
{
    makeRequest("/api/status", "GET");
}

void ApiClient::connectToBackend()
{
    checkConnection();
    startEventSource();
}

void ApiClient::startEventSource()
{
    if (m_eventReply) {
        m_eventReply->abort();
        m_eventReply->deleteLater();
    }
    
    QUrl url(m_baseUrl + "/api/events");
    QNetworkRequest request(url);
    request.setRawHeader("Accept", "text/event-stream");
    request.setRawHeader("Cache-Control", "no-cache");
    request.setRawHeader("Connection", "keep-alive");
    
    m_eventReply = m_eventManager->get(request);
    
    connect(m_eventReply, &QNetworkReply::readyRead, this, &ApiClient::onEventDataAvailable);
    connect(m_eventReply, QOverload<QAbstractSocket::SocketError>::of(&QNetworkReply::error),
            this, &ApiClient::onEventError);
    connect(m_eventReply, &QNetworkReply::finished, this, &ApiClient::onEventReplyFinished);
}

void ApiClient::onEventDataAvailable()
{
    if (!m_eventReply) return;
    
    QByteArray data = m_eventReply->readAll();
    m_eventBuffer += QString::fromUtf8(data);
    
    // Parse SSE events (lines ending with \n\n)
    QStringList events = m_eventBuffer.split("\n\n");
    if (events.size() > 1) {
        m_eventBuffer = events.takeLast();
        
        for (const QString &event : events) {
            QString eventData = parseSseEvent(event);
            if (eventData.isEmpty()) continue;
            
            // Parse JSON
            QJsonParseError parseError;
            QJsonDocument doc = QJsonDocument::fromJson(eventData.toUtf8(), &parseError);
            if (parseError.error != QJsonParseError::NoError) {
                qDebug() << "SSE parse error:" << parseError.errorString();
                continue;
            }
            
            QJsonObject obj = doc.object();
            QString type = obj["type"].toString();
            
            // Handle different event types
            if (type == "hello") {
                m_connected = true;
                emit connected();
                m_pingTimer->start();
                m_reconnectTimer->stop();
                qDebug() << "Connected to Amethyst backend";
            } else if (type == "status") {
                emit status(obj["message"].toString());
            } else if (type == "task-start") {
                emit taskStarted(obj["name"].toString());
            } else if (type == "task-complete") {
                emit taskCompleted(obj["name"].toString());
                emit status("Ready");
            } else if (type == "task-error") {
                emit taskError(obj["name"].toString(), obj["message"].toString());
            } else if (type == "download-progress") {
                int percent = obj["percent"].toDouble();
                emit downloadProgress(obj["label"].toString(), 
                                    obj["received"].toInteger(),
                                    obj["total"].toInteger(),
                                    percent);
                emit progress("download", percent, obj["label"].toString());
            } else if (type == "download-start") {
                emit downloadStarted(obj["label"].toString(), obj["total"].toInteger());
            } else if (type == "download-complete") {
                emit downloadComplete(obj["label"].toString());
            } else if (type == "download-skip") {
                emit downloadSkipped(obj["label"].toString());
            } else if (type == "launch-start") {
                emit launchStarted(obj["versionId"].toString(), obj["java"].toString());
                emit status(QString("Launching %1...").arg(obj["versionId"].toString()));
            } else if (type == "launch-exit") {
                emit launchExited(obj["versionId"].toString(), obj["code"].toInt());
                emit status("Ready");
            } else if (type == "game-log") {
                emit gameLog(obj["stream"].toString(), obj["message"].toString());
            }
        }
    }
}

QString ApiClient::parseSseEvent(const QString &event)
{
    // SSE format: "data: {...json...}\n\n"
    QRegularExpression re("^data:\\s*(.+)$", QRegularExpression::MultilineOption);
    QRegularExpressionMatch match = re.match(event);
    if (match.hasMatch()) {
        return match.captured(1).trimmed();
    }
    return QString();
}

void ApiClient::onEventError(QAbstractSocket::SocketError socketError)
{
    Q_UNUSED(socketError);
    if (m_eventReply) {
        qDebug() << "Event source error:" << m_eventReply->errorString();
    }
    
    m_connected = false;
    emit disconnected();
    m_pingTimer->stop();
    
    // Attempt to reconnect
    if (socketError != QAbstractSocket::RemoteHostClosedError) {
        m_reconnectTimer->start();
    }
}

void ApiClient::onEventReplyFinished()
{
    if (m_eventReply) {
        int statusCode = m_eventReply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        qDebug() << "Event source closed, status:" << statusCode;
    }
    
    m_connected = false;
    emit disconnected();
    m_pingTimer->stop();
    
    // Reconnect if not intentionally closed
    m_reconnectTimer->start();
}

void ApiClient::makeRequest(const QString &path, const QString &method, const QJsonObject &body)
{
    QUrl url(m_baseUrl + path);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    
    QNetworkReply *reply = nullptr;
    
    if (method == "GET") {
        reply = m_networkManager->get(request);
    } else if (method == "POST") {
        QByteArray jsonData = QJsonDocument(body).toJson();
        reply = m_networkManager->post(request, jsonData);
    } else if (method == "DELETE") {
        reply = m_networkManager->deleteResource(request);
    }
    
    if (reply) {
        m_pendingRequests[reply] = path;
        connect(reply, QOverload<QNetworkReply::NetworkError>::of(&QNetworkReply::error),
                this, &ApiClient::onNetworkError);
        
        // Route to appropriate handler
        if (path == "/api/status") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onStatusRequestFinished);
        } else if (path == "/api/versions") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onVersionsFinished);
        } else if (path == "/api/java") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onJavaFinished);
        } else if (path == "/api/accounts") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onAccountsFinished);
        } else if (path == "/api/settings") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onSettingsFinished);
        } else if (path == "/api/news") {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onNewsFinished);
        } else if (path.startsWith("/api/install")) {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onInstallFinished);
        } else if (path.startsWith("/api/launch")) {
            connect(reply, &QNetworkReply::finished, this, &ApiClient::onLaunchFinished);
        }
    }
}

void ApiClient::makePostRequest(const QString &path, const QJsonObject &body)
{
    makeRequest(path, "POST", body);
}

void ApiClient::makeDeleteRequest(const QString &path)
{
    makeRequest(path, "DELETE");
}

void ApiClient::onNetworkError(QNetworkReply::NetworkError error)
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    QString path = m_pendingRequests.value(reply, "unknown");
    qDebug() << "Network error for" << path << ":" << reply->errorString();
    
    emit error(reply->errorString());
    m_pendingRequests.remove(reply);
}

void ApiClient::onStatusRequestFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        if (obj.contains("app") && obj["app"].toString() == "Amethyst") {
            if (!m_connected) {
                m_connected = true;
                emit connected();
                startEventSource();
            }
        }
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::getVersions()
{
    makeRequest("/api/versions", "GET");
}

void ApiClient::onVersionsFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        if (doc.isArray()) {
            emit versionsReceived(doc.array());
        }
    } else {
        emit error("Failed to fetch versions: " + reply->errorString());
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::getJava()
{
    makeRequest("/api/java", "GET");
}

void ApiClient::onJavaFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        if (obj.contains("installations")) {
            emit javaReceived(obj["installations"].toArray());
        }
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::getAccounts()
{
    makeRequest("/api/accounts", "GET");
}

void ApiClient::onAccountsFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        if (obj.contains("accounts")) {
            emit accountsReceived(obj["accounts"].toArray());
        }
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::addAccount(const QString &username)
{
    QJsonObject body;
    body["username"] = username;
    makePostRequest("/api/accounts", body);
}

void ApiClient::onAddAccountFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        // Refresh accounts list
        getAccounts();
    } else {
        emit error("Failed to add account: " + reply->errorString());
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::removeAccount(const QString &accountId)
{
    QString path = QString("/api/accounts/%1").arg(QUrl::toPercentEncoding(accountId));
    makeDeleteRequest(path);
}

void ApiClient::onRemoveAccountFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        getAccounts();
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::getSettings()
{
    makeRequest("/api/settings", "GET");
}

void ApiClient::onSettingsFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        if (obj.contains("settings")) {
            emit settingsReceived(obj["settings"].toObject());
        }
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::saveSettings(const QVariantMap &settings)
{
    QJsonObject obj;
    for (auto it = settings.constBegin(); it != settings.constEnd(); ++it) {
        if (it.value().typeId() == QMetaType::Int) {
            obj[it.key()] = it.value().toInt();
        } else if (it.value().typeId() == QMetaType::QString) {
            obj[it.key()] = it.value().toString();
        } else if (it.value().typeId() == QMetaType::Bool) {
            obj[it.key()] = it.value().toBool();
        }
    }
    makePostRequest("/api/settings", obj);
}

void ApiClient::onSaveSettingsFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (reply && reply->error() != QNetworkReply::NoError) {
        emit error("Failed to save settings: " + reply->errorString());
    }
    
    if (reply) {
        m_pendingRequests.remove(reply);
        reply->deleteLater();
    }
}

void ApiClient::getNews()
{
    makeRequest("/api/news", "GET");
}

void ApiClient::onNewsFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        if (obj.contains("entries")) {
            emit newsReceived(obj["entries"].toArray());
        }
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::installVersion(const QString &versionId, const QVariantMap &options)
{
    QJsonObject body;
    body["versionId"] = versionId;
    
    for (auto it = options.constBegin(); it != options.constEnd(); ++it) {
        if (it.value().typeId() == QMetaType::Int) {
            body[it.key()] = it.value().toInt();
        } else if (it.value().typeId() == QMetaType::QString) {
            body[it.key()] = it.value().toString();
        }
    }
    
    makePostRequest("/api/install", body);
}

void ApiClient::onInstallFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        QString versionId = obj["versionId"].toString();
        emit installComplete(versionId);
    } else {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        emit installError(obj["error"].toString());
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}

void ApiClient::launchVersion(const QString &versionId, const QVariantMap &options)
{
    QJsonObject body;
    body["versionId"] = versionId;
    
    for (auto it = options.constBegin(); it != options.constEnd(); ++it) {
        if (it.value().typeId() == QMetaType::Int) {
            body[it.key()] = it.value().toInt();
        } else if (it.value().typeId() == QMetaType::QString) {
            body[it.key()] = it.value().toString();
        }
    }
    
    makePostRequest("/api/launch", body);
}

void ApiClient::onLaunchFinished()
{
    QNetworkReply *reply = qobject_cast<QNetworkReply*>(sender());
    if (!reply) return;
    
    if (reply->error() == QNetworkReply::NoError) {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        
        QString versionId = obj["versionId"].toString();
        emit launchComplete(versionId);
    } else {
        QByteArray data = reply->readAll();
        QJsonDocument doc = QJsonDocument::fromJson(data);
        QJsonObject obj = doc.object();
        emit launchError(obj["error"].toString());
    }
    
    m_pendingRequests.remove(reply);
    reply->deleteLater();
}
