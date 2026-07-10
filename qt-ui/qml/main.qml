import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import QtQuick.Controls.Material
import QtQuick.Shapes

ApplicationWindow {
    id: mainWindow
    visible: true
    width: 1200
    height: 800
    minimumWidth: 900
    minimumHeight: 600
    title: "Amethyst"
    
    // Dark purple theme colors
    property color primaryColor: "#9B59B6"
    property color primaryDark: "#8E44AD"
    property color primaryLight: "#BB8FCE"
    property color accentColor: "#E74C3C"
    property color backgroundColor: "#1a1a2e"
    property color surfaceColor: "#16213e"
    property color cardColor: "#1f2937"
    property color textPrimary: "#ffffff"
    property color textSecondary: "#a0aec0"
    property color borderColor: "#2d3748"
    
    // Material theming
    Material.theme: Material.Dark
    Material.primary: primaryColor
    Material.accent: accentColor
    Material.background: backgroundColor
    
    // Start backend on load
    Component.onCompleted: {
        launcher.startBackend()
    }
    
    // Main layout
    RowLayout {
        anchors.fill: parent
        spacing: 0
        
        // Left sidebar navigation
        Rectangle {
            Layout.preferredWidth: 220
            Layout.fillHeight: true
            color: surfaceColor
            
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 0
                spacing: 0
                
                // Logo/Title area
                Rectangle {
                    Layout.preferredHeight: 80
                    Layout.fillWidth: true
                    color: primaryDark
                    
                    Column {
                        anchors.centerIn: parent
                        spacing: 4
                        
                        Text {
                            text: "Amethyst"
                            color: textPrimary
                            font.pixelSize: 24
                            font.bold: true
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                        
                        Text {
                            text: "Minecraft Launcher"
                            color: textSecondary
                            font.pixelSize: 12
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                    }
                }
                
                // Navigation items
                ListModel {
                    id: navModel
                    ListElement { name: "Home"; icon: "🏠"; page: "home" }
                    ListElement { name: "Versions"; icon: "📦"; page: "versions" }
                    ListElement { name: "Accounts"; icon: "👤"; page: "accounts" }
                    ListElement { name: "Settings"; icon: "⚙️"; page: "settings" }
                }
                
                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    model: navModel
                    spacing: 4
                    padding: 12
                    
                    delegate: Rectangle {
                        width: parent ? parent.width - 24 : 196
                        height: 48
                        radius: 8
                        color: launcher.currentPage === page ? primaryColor : "transparent"
                        
                        Behavior on color { ColorAnimation { duration: 200 } }
                        
                        Row {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 16
                            spacing: 12
                            
                            Text {
                                text: icon
                                font.pixelSize: 20
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            
                            Text {
                                text: name
                                color: textPrimary
                                font.pixelSize: 14
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }
                        
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: launcher.navigateTo(page)
                        }
                    }
                }
                
                // Status bar at bottom
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 60
                    color: backgroundColor
                    border.color: borderColor
                    border.width: 1
                    
                    Column {
                        anchors.centerIn: parent
                        spacing: 4
                        
                        Row {
                            spacing: 8
                            anchors.horizontalCenter: parent.horizontalCenter
                            
                            CircleIndicator {
                                color: apiClient.isConnected ? "#2ecc71" : "#e74c3c"
                                size: 8
                            }
                            
                            Text {
                                text: apiClient.isConnected ? "Connected" : "Disconnected"
                                color: textSecondary
                                font.pixelSize: 11
                            }
                        }
                        
                        Text {
                            text: "v" + launcher.appVersion
                            color: textSecondary
                            font.pixelSize: 10
                            anchors.horizontalCenter: parent.horizontalCenter
                        }
                    }
                }
            }
        }
        
        // Main content area
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: backgroundColor
            
            // Status bar at top
            Rectangle {
                id: statusBar
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                height: 40
                color: cardColor
                
                Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.left: parent.left
                    anchors.leftMargin: 20
                    spacing: 12
                    
                    Text {
                        text: "💾 " + launcher.dataRoot
                        color: textSecondary
                        font.pixelSize: 11
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
                
                Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    anchors.rightMargin: 20
                    spacing: 16
                    
                    // Progress indicator when downloading
                    Row {
                        visible: launcher.downloadProgress > 0 && launcher.downloadProgress < 100
                        spacing: 8
                        anchors.verticalCenter: parent.verticalCenter
                        
                        ProgressBar {
                            width: 150
                            height: 6
                            value: launcher.downloadProgress / 100
                            Material.accent: primaryColor
                        }
                        
                        Text {
                            text: launcher.downloadProgress + "%"
                            color: textSecondary
                            font.pixelSize: 11
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        
                        Text {
                            text: launcher.downloadLabel
                            color: textSecondary
                            font.pixelSize: 11
                            anchors.verticalCenter: parent.verticalCenter
                            elide: Text.ElideRight
                            Layout.maximumWidth: 150
                        }
                    }
                    
                    Text {
                        text: launcher.statusMessage
                        color: textSecondary
                        font.pixelSize: 11
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            
            // Page content
            StackLayout {
                id: pageStack
                anchors.top: statusBar.bottom
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: 20
                currentIndex: pageIndex(launcher.currentPage)
                
                HomePage { id: homePage }
                VersionsPage { id: versionsPage }
                AccountsPage { id: accountsPage }
                SettingsPage { id: settingsPage }
            }
        }
    }
    
    // Helper function to get page index
    function pageIndex(pageName) {
        switch(pageName) {
            case "home": return 0
            case "versions": return 1
            case "accounts": return 2
            case "settings": return 3
            default: return 0
        }
    }
    
    // Circle indicator for status
    component CircleIndicator: Rectangle {
        property color color: "#2ecc71"
        property int size: 8
        
        width: size
        height: size
        radius: size / 2
        color: parent ? parent.color : color
        
        SequentialAnimation on color {
            running: true
            loops: Animation.Infinite
            ColorAnimation {
                from: color
                to: Qt.lighter(color, 1.3)
                duration: 1000
            }
            ColorAnimation {
                from: Qt.lighter(color, 1.3)
                to: color
                duration: 1000
            }
        }
    }
}
