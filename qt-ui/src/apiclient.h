#pragma once

#include <QObject>
#include <QString>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonDocument>
#include <QUrl>
#include <QTimer>
#include <QMap>

class ApiClient : public QObject
{
    Q_OBJECT

public:
    explicit ApiClient(QObject *parent = nullptr);
    ~ApiClient();

    // Backend URL (set after backend starts)
    void setBaseUrl(const QString &url);
    QString baseUrl() const { return m_baseUrl; }
    
    // Check if connected
    bool isConnected() const { return m_connected; }

signals:
    // Connection state
    void connected();
    void disconnected();
    void error(const QString &error);
    
    // API responses
    void versionsReceived(const QJsonArray &versions);
    void javaReceived(const QJsonArray &installations);
    void accountsReceived(const QJsonArray &accounts);
    void settingsReceived(const QJsonObject &settings);
    void newsReceived(const QJsonArray &news);
    
    // Operations
    void installComplete(const QString &versionId);
    void installError(const QString &error);
    void launchComplete(const QString &versionId);
    void launchError(const QString &error);
    
    // Progress updates (SSE events)
    void progress(const QString &task, int progress, const QString &label);
    void status(const QString &message);
    void taskStarted(const QString &task);
    void taskCompleted(const QString &task);
    void taskError(const QString &task, const QString &error);
    void downloadStarted(const QString &label, qint64 total);
    void downloadProgress(const QString &label, qint64 received, qint64 total, int percent);
    void downloadComplete(const QString &label);
    void downloadSkipped(const QString &label);
    void launchStarted(const QString &versionId, const QString &java);
    void launchExited(const QString &versionId, int exitCode);
    void gameLog(const QString &stream, const QString &message);

public slots:
    // Connection management
    void checkConnection();
    void connectToBackend();
    
    // API calls
    void getVersions();
    void getJava();
    void getAccounts();
    void addAccount(const QString &username);
    void removeAccount(const QString &accountId);
    void getSettings();
    void saveSettings(const QVariantMap &settings);
    void getNews();
    void installVersion(const QString &versionId, const QVariantMap &options = QVariantMap());
    void launchVersion(const QString &versionId, const QVariantMap &options = QVariantMap());

private slots:
    void onStatusRequestFinished();
    void onVersionsFinished();
    void onJavaFinished();
    void onAccountsFinished();
    void onAddAccountFinished();
    void onRemoveAccountFinished();
    void onSettingsFinished();
    void onSaveSettingsFinished();
    void onNewsFinished();
    void onInstallFinished();
    void onLaunchFinished();
    void onEventReplyFinished();
    
    void onNetworkError(QNetworkReply::NetworkError error);

    // Event source (SSE) handling
    void startEventSource();
    void onEventDataAvailable();
    void onEventError(QAbstractSocket::SocketError socketError);

private:
    void makeRequest(const QString &path, const QString &method = "GET", const QJsonObject &body = QJsonObject());
    void makePostRequest(const QString &path, const QJsonObject &body);
    void makeDeleteRequest(const QString &path);
    QString parseSseEvent(const QString &data);
    
    QNetworkAccessManager *m_networkManager = nullptr;
    QNetworkAccessManager *m_eventManager = nullptr;
    QNetworkReply *m_currentReply = nullptr;
    QNetworkReply *m_eventReply = nullptr;
    QString m_baseUrl;
    bool m_connected = false;
    QString m_eventBuffer;
    QTimer *m_reconnectTimer = nullptr;
    QTimer *m_pingTimer = nullptr;
    
    // Track pending requests
    QMap<QNetworkReply*, QString> m_pendingRequests;
};
