#pragma once

#include <QObject>
#include <QString>
#include <QStringList>
#include <QProcess>
#include <QSettings>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QUrl>
#include <QJsonObject>
#include <QJsonArray>
#include <QVariantList>
#include <QVariantMap>

class ApiClient;

class AmaranthLauncher : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString appVersion READ appVersion CONSTANT)
    Q_PROPERTY(QString dataRoot READ dataRoot CONSTANT)
    Q_PROPERTY(QString currentPage READ currentPage WRITE setCurrentPage NOTIFY currentPageChanged)
    Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusMessageChanged)
    Q_PROPERTY(bool isBusy READ isBusy NOTIFY isBusyChanged)
    Q_PROPERTY(QString busyTask READ busyTask NOTIFY busyTaskChanged)
    Q_PROPERTY(QString selectedVersion READ selectedVersion WRITE setSelectedVersion NOTIFY selectedVersionChanged)
    Q_PROPERTY(int memoryMb READ memoryMb WRITE setMemoryMb NOTIFY memoryMbChanged)

public:
    explicit AmaranthLauncher(QObject *parent = nullptr);
    ~AmaranthLauncher();
    
    // API client reference
    void setApiClient(ApiClient *client);
    ApiClient* apiClient() const { return m_apiClient; }
    
    // Constants
    QString appVersion() const { return "0.1.0"; }
    QString dataRoot() const;
    
    // Navigation
    QString currentPage() const { return m_currentPage; }
    void setCurrentPage(const QString &page);
    
    // Status
    QString statusMessage() const { return m_statusMessage; }
    bool isBusy() const { return m_busyTask != "none" && !m_busyTask.isEmpty(); }
    QString busyTask() const { return m_busyTask; }
    
    // Version selection
    QString selectedVersion() const { return m_selectedVersion; }
    void setSelectedVersion(const QString &version);
    
    // Memory settings
    int memoryMb() const { return m_memoryMb; }
    void setMemoryMb(int mb);
    
    // Available versions (from API)
    QVariantList versions() const { return m_versions; }
    void setVersions(const QVariantList &versions);
    
    // Java installations (from API)
    QVariantList javaInstallations() const { return m_javaInstallations; }
    void setJavaInstallations(const QVariantList &installations);
    
    // Accounts (from API)
    QVariantList accounts() const { return m_accounts; }
    void setAccounts(const QVariantList &accounts);
    QString selectedAccountId() const { return m_selectedAccountId; }
    void setSelectedAccountId(const QString &id);
    
    // Settings
    QString javaPathOverride() const { return m_javaPathOverride; }
    void setJavaPathOverride(const QString &path);
    
    // Progress
    int downloadProgress() const { return m_downloadProgress; }
    void setDownloadProgress(int progress);
    
    QString downloadLabel() const { return m_downloadLabel; }
    void setDownloadLabel(const QString &label);
    
signals:
    void currentPageChanged();
    void statusMessageChanged();
    void isBusyChanged();
    void busyTaskChanged();
    void selectedVersionChanged();
    void memoryMbChanged();
    void versionsChanged();
    void javaInstallationsChanged();
    void accountsChanged();
    void selectedAccountIdChanged();
    void javaPathOverrideChanged();
    void downloadProgressChanged();
    void downloadLabelChanged();
    void launchStarted();
    void launchFinished();
    void errorOccurred(const QString &error);
    void newsLoaded(const QVariantList &news);

public slots:
    // Backend process management
    void startBackend();
    void stopBackend();
    
    // API calls
    void refreshVersions();
    void refreshJava();
    void refreshAccounts();
    void refreshNews();
    void loadSettings();
    
    // Account management
    void addAccount(const QString &username);
    void removeAccount(const QString &accountId);
    
    // Version actions
    void installVersion(const QString &versionId);
    void launchVersion();
    
    // Settings
    void saveSettings();
    
    // UI actions
    void navigateTo(const QString &page);
    void showError(const QString &title, const QString &message);
    void showNotification(const QString &message);

private slots:
    void onBackendStarted();
    void onBackendError(QProcess::ProcessError error);
    void onBackendFinished(int exitCode, QProcess::ExitStatus exitStatus);
    void onBackendReadyRead();
    void onBackendReadyReadError();
    
    void onApiVersionsReceived(const QJsonArray &versions);
    void onApiJavaReceived(const QJsonArray &installations);
    void onApiAccountsReceived(const QJsonArray &accounts);
    void onApiSettingsReceived(const QJsonObject &settings);
    void onApiNewsReceived(const QJsonArray &news);
    void onApiError(const QString &error);
    void onApiInstallComplete(const QString &versionId);
    void onApiLaunchComplete(const QString &versionId);
    void onApiLaunchError(const QString &error);
    void onApiProgress(const QString &task, int progress, const QString &label);
    void onApiStatus(const QString &message);

private:
    ApiClient *m_apiClient = nullptr;
    QProcess *m_backendProcess = nullptr;
    QString m_currentPage = "home";
    QString m_statusMessage;
    QString m_busyTask;
    QString m_selectedVersion;
    int m_memoryMb = 2048;
    QVariantList m_versions;
    QVariantList m_javaInstallations;
    QVariantList m_accounts;
    QString m_selectedAccountId;
    QString m_javaPathOverride;
    int m_downloadProgress = 0;
    QString m_downloadLabel;
    QVariantList m_news;
    QSettings m_settings;
    
    QString findNodeExecutable() const;
    QString getAppPath() const;
};
