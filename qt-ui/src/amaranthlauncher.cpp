#include "amaranthlauncher.h"
#include "apiclient.h"

#include <QApplication>
#include <QProcess>
#include <QDir>
#include <QFileInfo>
#include <QStandardPaths>
#include <QMessageBox>
#include <QTimer>
#include <QJsonDocument>
#include <QJsonArray>
#include <QDebug>
#include <QTcpServer>
#include <QHostAddress>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

AmaranthLauncher::AmaranthLauncher(QObject *parent)
    : QObject(parent)
    , m_settings("Amethyst", "Amethyst")
{
    // Load saved settings
    m_memoryMb = m_settings.value("memoryMb", 2048).toInt();
    m_javaPathOverride = m_settings.value("javaPath", "").toString();
    m_selectedAccountId = m_settings.value("lastAccountId", "").toString();
    
    // Set data root path
    QString dataRoot = qEnvironmentVariable("AMETHYST_HOME");
    if (dataRoot.isEmpty()) {
        dataRoot = QDir::toNativeSeparators(QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).absolutePath());
    }
    
    // Create backend process
    m_backendProcess = new QProcess(this);
    connect(m_backendProcess, &QProcess::started, this, &AmaranthLauncher::onBackendStarted);
    connect(m_backendProcess, QOverload<QProcess::ProcessError>::of(&QProcess::error),
            this, &AmaranthLauncher::onBackendError);
    connect(m_backendProcess, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
            this, &AmaranthLauncher::onBackendFinished);
    connect(m_backendProcess, &QProcess::readyReadStandardOutput, this, &AmaranthLauncher::onBackendReadyRead);
    connect(m_backendProcess, &QProcess::readyReadStandardError, this, &AmaranthLauncher::onBackendReadyReadError);
}

AmaranthLauncher::~AmaranthLauncher()
{
    stopBackend();
}

QString AmaranthLauncher::dataRoot() const
{
    QString dataRoot = qEnvironmentVariable("AMETHYST_HOME");
    if (dataRoot.isEmpty()) {
        dataRoot = QDir::toNativeSeparators(QDir(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)).absolutePath());
    }
    return dataRoot;
}

void AmaranthLauncher::setApiClient(ApiClient *client)
{
    m_apiClient = client;
    
    if (m_apiClient) {
        // Connect API signals
        connect(m_apiClient, &ApiClient::versionsReceived, this, &AmaranthLauncher::onApiVersionsReceived);
        connect(m_apiClient, &ApiClient::javaReceived, this, &AmaranthLauncher::onApiJavaReceived);
        connect(m_apiClient, &ApiClient::accountsReceived, this, &AmaranthLauncher::onApiAccountsReceived);
        connect(m_apiClient, &ApiClient::settingsReceived, this, &AmaranthLauncher::onApiSettingsReceived);
        connect(m_apiClient, &ApiClient::newsReceived, this, &AmaranthLauncher::onApiNewsReceived);
        connect(m_apiClient, &ApiClient::error, this, &AmaranthLauncher::onApiError);
        connect(m_apiClient, &ApiClient::installComplete, this, &AmaranthLauncher::onApiInstallComplete);
        connect(m_apiClient, &ApiClient::launchComplete, this, &AmaranthLauncher::onApiLaunchComplete);
        connect(m_apiClient, &ApiClient::launchError, this, &AmaranthLauncher::onApiLaunchError);
        connect(m_apiClient, &ApiClient::progress, this, &AmaranthLauncher::onApiProgress);
        connect(m_apiClient, &ApiClient::status, this, &AmaranthLauncher::onApiStatus);
        connect(m_apiClient, &ApiClient::taskStarted, this, &AmaranthLauncher::onApiStatus);
        connect(m_apiClient, &ApiClient::taskCompleted, this, &AmaranthLauncher::onApiStatus);
        connect(m_apiClient, &ApiClient::taskError, this, &AmaranthLauncher::onApiError);
    }
}

void AmaranthLauncher::startBackend()
{
    if (m_backendProcess->state() != QProcess::NotRunning) {
        return;
    }
    
    QString nodePath = findNodeExecutable();
    if (nodePath.isEmpty()) {
        showError("Node.js Not Found", 
                  "Amethyst requires Node.js 18 or newer to run.\n\n"
                  "Please install Node.js from https://nodejs.org/");
        return;
    }
    
    // Get the app directory (where the Node.js source is)
    QString appPath = getAppPath();
    QString serverScript = appPath + QDir::separator() + "src" + QDir::separator() + "main.js";
    
    if (!QFileInfo::exists(serverScript)) {
        showError("Startup Error", 
                  QString("Could not find launcher script at:\n%1").arg(serverScript));
        return;
    }
    
    qDebug() << "Starting backend with Node.js:" << nodePath;
    qDebug() << "Script:" << serverScript;
    
    // Reserve an available loopback port, then give it to both the backend and
    // API client. The backend normally chooses a random port, which the native
    // UI would otherwise have no reliable way to discover.
    QTcpServer portProbe;
    if (!portProbe.listen(QHostAddress::LocalHost, 0)) {
        showError("Startup Error", "Could not reserve a local port for the launcher backend.");
        return;
    }
    const quint16 backendPort = portProbe.serverPort();
    portProbe.close();

    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert("AMETHYST_NO_OPEN", "1");
    env.insert("PORT", QString::number(backendPort));
    m_backendProcess->setProcessEnvironment(env);
    m_backendProcess->setWorkingDirectory(appPath);
    if (m_apiClient) {
        m_apiClient->setBaseUrl(QString("http://127.0.0.1:%1").arg(backendPort));
    }

    // Start Node.js with the main script.
    m_backendProcess->start(nodePath, QStringList() << serverScript);
}

void AmaranthLauncher::stopBackend()
{
    if (m_backendProcess->state() != QProcess::NotRunning) {
        m_backendProcess->terminate();
        if (!m_backendProcess->waitForFinished(3000)) {
            m_backendProcess->kill();
        }
    }
}

QString AmaranthLauncher::findNodeExecutable() const
{
    // Check environment variable first
    QString nodePath = qEnvironmentVariable("NODE_PATH");
    if (!nodePath.isEmpty() && QFileInfo::exists(nodePath)) {
        return nodePath;
    }
    
    // Common Node.js locations
    QStringList possiblePaths;
    
#ifdef Q_OS_WIN
    possiblePaths << "C:\\Program Files\\nodejs\\node.exe"
                 << "C:\\Program Files (x86)\\nodejs\\node.exe"
                 << qEnvironmentVariable("ProgramFiles") + "\\nodejs\\node.exe";
#elif defined(Q_OS_MAC)
    possiblePaths << "/usr/local/bin/node"
                 << "/usr/bin/node"
                 << QDir::homePath() + "/.nvm/versions/node/*/bin/node";
#else // Linux
    possiblePaths << "/usr/bin/node"
                 << "/usr/local/bin/node"
                 << "/snap/bin/node";
#endif
    
    for (const QString &path : possiblePaths) {
        if (QFileInfo::exists(path)) {
            return path;
        }
    }
    
    // Try to find node in PATH
    QString node = QStandardPaths::findExecutable("node");
    if (!node.isEmpty()) {
        return node;
    }
    
    return QString();
}

QString AmaranthLauncher::getAppPath() const
{
    // Development builds live in qt-ui/build (or qt-ui/build/<config> on
    // multi-config generators), while packaged builds may place the executable
    // beside the backend. Search upwards rather than assuming one layout.
    QDir directory(QApplication::applicationDirPath());
    for (int depth = 0; depth < 5; ++depth) {
        if (QFileInfo::exists(directory.filePath("src/main.js"))) {
            return directory.absolutePath();
        }
        if (!directory.cdUp()) {
            break;
        }
    }

    // Also support launching a development binary from the project root.
    QDir current(QDir::currentPath());
    if (QFileInfo::exists(current.filePath("src/main.js"))) {
        return current.absolutePath();
    }
    return QApplication::applicationDirPath();
}

void AmaranthLauncher::onBackendStarted()
{
    qDebug() << "Backend started";
    m_statusMessage = "Connecting to backend...";
    emit statusMessageChanged();
    
    // Give the backend a moment to start
    QTimer::singleShot(500, this, [this]() {
        // Open the event stream before loading initial data so progress and
        // backend status updates reach the native UI.
        if (m_apiClient) {
            m_apiClient->connectToBackend();
        }
        refreshVersions();
        refreshJava();
        refreshAccounts();
        loadSettings();
        refreshNews();
    });
}

void AmaranthLauncher::onBackendError(QProcess::ProcessError error)
{
    QString errorMsg;
    switch (error) {
        case QProcess::FailedToStart:
            errorMsg = "Failed to start backend process";
            break;
        case QProcess::Crashed:
            errorMsg = "Backend process crashed";
            break;
        case QProcess::Timedout:
            errorMsg = "Backend process timed out";
            break;
        default:
            errorMsg = "Backend process error";
    }
    qDebug() << "Backend error:" << errorMsg;
    emit errorOccurred(errorMsg);
}

void AmaranthLauncher::onBackendFinished(int exitCode, QProcess::ExitStatus exitStatus)
{
    if (exitStatus == QProcess::CrashExit) {
        emit errorOccurred("Backend process crashed");
    } else {
        qDebug() << "Backend finished with exit code:" << exitCode;
    }
}

void AmaranthLauncher::onBackendReadyRead()
{
    QString output = QString::fromUtf8(m_backendProcess->readAllStandardOutput());
    qDebug() << "Backend:" << output.trimmed();
}

void AmaranthLauncher::onBackendReadyReadError()
{
    QString output = QString::fromUtf8(m_backendProcess->readAllStandardError());
    qDebug() << "Backend error:" << output.trimmed();
}

void AmaranthLauncher::setCurrentPage(const QString &page)
{
    if (m_currentPage != page) {
        m_currentPage = page;
        emit currentPageChanged();
    }
}

void AmaranthLauncher::setSelectedVersion(const QString &version)
{
    if (m_selectedVersion != version) {
        m_selectedVersion = version;
        emit selectedVersionChanged();
    }
}

void AmaranthLauncher::setMemoryMb(int mb)
{
    if (m_memoryMb != mb) {
        m_memoryMb = mb;
        m_settings.setValue("memoryMb", mb);
        emit memoryMbChanged();
    }
}

void AmaranthLauncher::setVersions(const QVariantList &versions)
{
    m_versions = versions;
    emit versionsChanged();
}

void AmaranthLauncher::setJavaInstallations(const QVariantList &installations)
{
    m_javaInstallations = installations;
    emit javaInstallationsChanged();
}

void AmaranthLauncher::setAccounts(const QVariantList &accounts)
{
    m_accounts = accounts;
    emit accountsChanged();
}

void AmaranthLauncher::setSelectedAccountId(const QString &id)
{
    if (m_selectedAccountId != id) {
        m_selectedAccountId = id;
        m_settings.setValue("lastAccountId", id);
        emit selectedAccountIdChanged();
    }
}

void AmaranthLauncher::setJavaPathOverride(const QString &path)
{
    if (m_javaPathOverride != path) {
        m_javaPathOverride = path;
        m_settings.setValue("javaPath", path);
        emit javaPathOverrideChanged();
    }
}

void AmaranthLauncher::setDownloadProgress(int progress)
{
    if (m_downloadProgress != progress) {
        m_downloadProgress = progress;
        emit downloadProgressChanged();
    }
}

void AmaranthLauncher::setDownloadLabel(const QString &label)
{
    if (m_downloadLabel != label) {
        m_downloadLabel = label;
        emit downloadLabelChanged();
    }
}

// API Calls
void AmaranthLauncher::refreshVersions()
{
    if (m_apiClient) {
        m_apiClient->getVersions();
    }
}

void AmaranthLauncher::refreshJava()
{
    if (m_apiClient) {
        m_apiClient->getJava();
    }
}

void AmaranthLauncher::refreshAccounts()
{
    if (m_apiClient) {
        m_apiClient->getAccounts();
    }
}

void AmaranthLauncher::refreshNews()
{
    if (m_apiClient) {
        m_apiClient->getNews();
    }
}

void AmaranthLauncher::loadSettings()
{
    if (m_apiClient) {
        m_apiClient->getSettings();
    }
}

void AmaranthLauncher::addAccount(const QString &username)
{
    if (m_apiClient && !username.isEmpty()) {
        m_apiClient->addAccount(username);
    }
}

void AmaranthLauncher::removeAccount(const QString &accountId)
{
    if (m_apiClient && !accountId.isEmpty()) {
        m_apiClient->removeAccount(accountId);
    }
}

void AmaranthLauncher::installVersion(const QString &versionId)
{
    if (m_apiClient && !versionId.isEmpty()) {
        QVariantMap options;
        options["memoryMb"] = m_memoryMb;
        if (!m_javaPathOverride.isEmpty()) {
            options["javaPath"] = m_javaPathOverride;
        }
        m_apiClient->installVersion(versionId, options);
    }
}

void AmaranthLauncher::launchVersion()
{
    if (m_apiClient && !m_selectedVersion.isEmpty()) {
        if (m_accounts.isEmpty()) {
            showError("No Account", "Please create an account first.");
            return;
        }
        
        QVariantMap options;
        options["memoryMb"] = m_memoryMb;
        if (!m_javaPathOverride.isEmpty()) {
            options["javaPath"] = m_javaPathOverride;
        }
        if (!m_selectedAccountId.isEmpty()) {
            options["accountId"] = m_selectedAccountId;
        }
        
        m_apiClient->launchVersion(m_selectedVersion, options);
    }
}

void AmaranthLauncher::saveSettings()
{
    if (m_apiClient) {
        QVariantMap settings;
        settings["memoryMb"] = m_memoryMb;
        if (!m_javaPathOverride.isEmpty()) {
            settings["javaPath"] = m_javaPathOverride;
        }
        m_apiClient->saveSettings(settings);
    }
}

void AmaranthLauncher::navigateTo(const QString &page)
{
    setCurrentPage(page);
}

void AmaranthLauncher::showError(const QString &title, const QString &message)
{
    QMessageBox msgBox;
    msgBox.setIcon(QMessageBox::Critical);
    msgBox.setWindowTitle(title);
    msgBox.setText(message);
    msgBox.exec();
    
    emit errorOccurred(message);
}

void AmaranthLauncher::showNotification(const QString &message)
{
    m_statusMessage = message;
    emit statusMessageChanged();
}

// API Response Handlers
void AmaranthLauncher::onApiVersionsReceived(const QJsonArray &versions)
{
    QVariantList list;
    for (const QJsonValue &v : versions) {
        list.append(v.toObject().toVariantMap());
    }
    setVersions(list);
}

void AmaranthLauncher::onApiJavaReceived(const QJsonArray &installations)
{
    QVariantList list;
    for (const QJsonValue &v : installations) {
        list.append(v.toObject().toVariantMap());
    }
    setJavaInstallations(list);
}

void AmaranthLauncher::onApiAccountsReceived(const QJsonArray &accounts)
{
    QVariantList list;
    for (const QJsonValue &v : accounts) {
        list.append(v.toObject().toVariantMap());
    }
    setAccounts(list);
}

void AmaranthLauncher::onApiSettingsReceived(const QJsonObject &settings)
{
    if (settings.contains("memoryMb")) {
        setMemoryMb(settings["memoryMb"].toInt());
    }
    if (settings.contains("javaPath")) {
        setJavaPathOverride(settings["javaPath"].toString());
    }
}

void AmaranthLauncher::onApiNewsReceived(const QJsonArray &news)
{
    QVariantList list;
    for (const QJsonValue &v : news) {
        list.append(v.toObject().toVariantMap());
    }
    m_news = list;
    emit newsLoaded(list);
}

void AmaranthLauncher::onApiError(const QString &error)
{
    m_statusMessage = error;
    emit statusMessageChanged();
    showError("Error", error);
}

void AmaranthLauncher::onApiInstallComplete(const QString &versionId)
{
    m_statusMessage = QString("Installed %1").arg(versionId);
    emit statusMessageChanged();
}

void AmaranthLauncher::onApiLaunchComplete(const QString &versionId)
{
    m_statusMessage = QString("Launched %1").arg(versionId);
    emit statusMessageChanged();
    emit launchStarted();
}

void AmaranthLauncher::onApiLaunchError(const QString &error)
{
    showError("Launch Failed", error);
}

void AmaranthLauncher::onApiProgress(const QString &task, int progress, const QString &label)
{
    Q_UNUSED(task);
    setDownloadProgress(progress);
    setDownloadLabel(label);
}

void AmaranthLauncher::onApiStatus(const QString &message)
{
    m_statusMessage = message;
    emit statusMessageChanged();
}
