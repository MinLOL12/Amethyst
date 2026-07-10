#include <QApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QFont>
#include <QDir>
#include <QUrl>

#include "amaranthlauncher.h"
#include "apiclient.h"

int main(int argc, char *argv[])
{
    QApplication::setAttribute(Qt::AA_EnableHighDpiScaling);
    QApplication::setAttribute(Qt::AA_UseHighDpiPixmaps);
    
    QApplication app(argc, argv);
    app.setApplicationName("Amethyst");
    app.setApplicationVersion("0.1.0");
    app.setOrganizationName("Amethyst Contributors");
    
    // Set default font
    QFont defaultFont = app.font();
    defaultFont.setPointSize(10);
    app.setFont(defaultFont);
    
    // Use Material style for best look
    QQuickStyle::setStyle("Material");
    
    // Create API client
    ApiClient apiClient;
    
    // Create and register the launcher controller
    AmaranthLauncher launcher;
    launcher.setApiClient(&apiClient);
    
    // QML Engine setup
    QQmlApplicationEngine engine;
    
    // Expose C++ objects to QML
    QQmlContext *context = engine.rootContext();
    context->setContextProperty("launcher", &launcher);
    context->setContextProperty("apiClient", &apiClient);
    
    // Set import paths
    engine.addImportPath("qrc:/");
    
    // Load main QML
    const QUrl url(QStringLiteral("qrc:/qml/main.qml"));
    QObject::connect(&engine, &QQmlApplicationEngine::objectCreated,
                     &app, [url](QObject *obj, const QUrl &objUrl) {
        if (!obj && url == objUrl)
            QCoreApplication::exit(-1);
    });
    
    engine.load(url);
    
    return app.exec();
}
