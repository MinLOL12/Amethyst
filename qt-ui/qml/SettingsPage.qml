import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Controls.Material

Rectangle {
    id: root
    color: "transparent"
    
    property color primaryColor: "#9B59B6"
    property color primaryDark: "#8E44AD"
    property color textPrimary: "#ffffff"
    property color textSecondary: "#a0aec0"
    property color cardColor: "#1f2937"
    property color accentColor: "#E74C3C"
    property color successColor: "#2ecc71"
    property color warningColor: "#f39c12"
    
    ColumnLayout {
        anchors.fill: parent
        spacing: 20
        
        // Header
        Row {
            Layout.fillWidth: true
            Layout.preferredHeight: 50
            spacing: 16
            
            Text {
                text: "Settings"
                color: textPrimary
                font.pixelSize: 24
                font.bold: true
                anchors.verticalCenter: parent.verticalCenter
            }
            
            Rectangle { Layout.fillWidth: true }
            
            Button {
                text: "💾 Save"
                highlighted: true
                Material.background: primaryColor
                anchors.verticalCenter: parent.verticalCenter
                onClicked: {
                    launcher.saveSettings()
                    launcher.showNotification("Settings saved!")
                }
            }
        }
        
        // Settings content
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            
            Column {
                spacing: 20
                width: root.width - 40
                
                // Java Settings
                SettingsCard {
                    title: "Java Settings"
                    icon: "☕"
                    
                    Column {
                        spacing: 16
                        width: parent.width
                        
                        // Java path override
                        Row {
                            spacing: 16
                            width: parent.width
                            
                            Column {
                                spacing: 8
                                Layout.fillWidth: true
                                
                                Text {
                                    text: "Java Path Override"
                                    color: textPrimary
                                    font.pixelSize: 14
                                }
                                
                                Text {
                                    text: "Leave empty for auto-detect"
                                    color: textSecondary
                                    font.pixelSize: 11
                                }
                                
                                TextField {
                                    id: javaPathField
                                    placeholderText: launcher.javaPathOverride || "Auto-detect"
                                    text: launcher.javaPathOverride
                                    width: 400
                                    Material.theme: Material.Dark
                                    
                                    onTextChanged: launcher.setJavaPathOverride(text)
                                }
                            }
                        }
                        
                        // Java installations
                        GroupBox {
                            title: "Detected Java Installations"
                            
                            Column {
                                spacing: 8
                                
                                Repeater {
                                    model: launcher.javaInstallations
                                    
                                    Row {
                                        spacing: 12
                                        
                                        Rectangle {
                                            width: 8
                                            height: 8
                                            radius: 4
                                            color: modelData.major >= 17 ? successColor : warningColor
                                            anchors.verticalCenter: parent.verticalCenter
                                        }
                                        
                                        Column {
                                            spacing: 2
                                            
                                            Text {
                                                text: modelData.path
                                                color: textPrimary
                                                font.pixelSize: 12
                                            }
                                            
                                            Text {
                                                text: "Java " + (modelData.major || "?") + " (" + (modelData.arch || "?") + ")"
                                                color: textSecondary
                                                font.pixelSize: 10
                                            }
                                        }
                                    }
                                }
                                
                                Text {
                                    text: "No Java installations detected"
                                    color: textSecondary
                                    font.pixelSize: 12
                                    visible: launcher.javaInstallations.length === 0
                                }
                            }
                        }
                    }
                }
                
                // Game Settings
                SettingsCard {
                    title: "Game Settings"
                    icon: "🎮"
                    
                    Column {
                        spacing: 16
                        width: parent.width
                        
                        // Memory allocation
                        Row {
                            spacing: 16
                            Layout.fillWidth: true
                            
                            Column {
                                spacing: 8
                                Layout.fillWidth: true
                                
                                Text {
                                    text: "Memory Allocation (RAM)"
                                    color: textPrimary
                                    font.pixelSize: 14
                                }
                                
                                Text {
                                    text: "Amount of RAM allocated to Minecraft"
                                    color: textSecondary
                                    font.pixelSize: 11
                                }
                                
                                Row {
                                    spacing: 12
                                    Layout.alignment: Qt.AlignHCenter
                                    
                                    Text {
                                        text: "512 MB"
                                        color: textSecondary
                                        font.pixelSize: 11
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                    
                                    Slider {
                                        id: memorySlider
                                        from: 512
                                        to: 16384
                                        stepSize: 256
                                        value: launcher.memoryMb
                                        width: 400
                                        
                                        onMoved: launcher.memoryMb = value
                                    }
                                    
                                    Text {
                                        text: "16 GB"
                                        color: textSecondary
                                        font.pixelSize: 11
                                        anchors.verticalCenter: parent.verticalCenter
                                    }
                                }
                                
                                Text {
                                    text: Math.round(memorySlider.value / 1024) + " GB (" + memorySlider.value + " MB)"
                                    color: primaryColor
                                    font.pixelSize: 16
                                    font.bold: true
                                    anchors.horizontalCenter: parent.horizontalCenter
                                }
                            }
                        }
                        
                        // Quick launch toggle
                        Row {
                            spacing: 16
                            
                            Column {
                                spacing: 4
                                
                                Text {
                                    text: "Quick Launch"
                                    color: textPrimary
                                    font.pixelSize: 14
                                }
                                
                                Text {
                                    text: "Open version details when download completes"
                                    color: textSecondary
                                    font.pixelSize: 11
                                }
                            }
                            
                            Rectangle { Layout.fillWidth: true }
                            
                            Switch {
                                id: quickLaunchSwitch
                                checked: true
                            }
                        }
                    }
                }
                
                // Data Settings
                SettingsCard {
                    title: "Data Settings"
                    icon: "📁"
                    
                    Column {
                        spacing: 16
                        width: parent.width
                        
                        // Data directory
                        Row {
                            spacing: 16
                            Layout.fillWidth: true
                            
                            Column {
                                spacing: 8
                                Layout.fillWidth: true
                                
                                Text {
                                    text: "Data Directory"
                                    color: textPrimary
                                    font.pixelSize: 14
                                }
                                
                                Text {
                                    text: launcher.dataRoot
                                    color: textSecondary
                                    font.pixelSize: 11
                                    wrapMode: Text.WordWrap
                                }
                                
                                Text {
                                    text: "Set AMETHYST_HOME environment variable to change"
                                    color: textSecondary
                                    font.pixelSize: 10
                                    font.italic: true
                                }
                            }
                        }
                        
                        // Open folder button
                        Button {
                            text: "📂 Open Data Folder"
                            flat: true
                            width: 200
                            
                            onClicked: {
                                Qt.openUrlExternally("file://" + launcher.dataRoot)
                            }
                        }
                    }
                }
                
                // About Section
                SettingsCard {
                    title: "About"
                    icon: "💎"
                    
                    Column {
                        spacing: 12
                        width: parent.width
                        
                        Row {
                            spacing: 12
                            
                            Text {
                                text: "Amethyst"
                                color: primaryColor
                                font.pixelSize: 20
                                font.bold: true
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            
                            Text {
                                text: "v" + launcher.appVersion
                                color: textSecondary
                                font.pixelSize: 14
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }
                        
                        Text {
                            text: "A dark purple Minecraft vanilla launcher built with Qt"
                            color: textSecondary
                            font.pixelSize: 12
                            wrapMode: Text.WordWrap
                        }
                        
                        Text {
                            text: "Amethyst does not include or redistribute Minecraft code. " +
                                  "All game files are downloaded from official Mojang/Microsoft servers."
                            color: textSecondary
                            font.pixelSize: 11
                            wrapMode: Text.WordWrap
                        }
                        
                        Rectangle {
                            width: parent.width
                            height: 1
                            color: "#ffffff"
                            opacity: 0.1
                        }
                        
                        Row {
                            spacing: 8
                            
                            Text {
                                text: "Backend:"
                                color: textSecondary
                                font.pixelSize: 11
                            }
                            
                            Rectangle {
                                width: 8
                                height: 8
                                radius: 4
                                color: apiClient.isConnected ? successColor : warningColor
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            
                            Text {
                                text: apiClient.isConnected ? "Running (Node.js)" : "Disconnected"
                                color: textSecondary
                                font.pixelSize: 11
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Settings card component
    component SettingsCard: Rectangle {
        property string title: ""
        property string icon: ""
        
        color: cardColor
        radius: 12
        Layout.fillWidth: true
        implicitHeight: contentColumn.height + 48
        
        Column {
            id: contentColumn
            anchors.fill: parent
            anchors.margins: 24
            spacing: 20
        }
        
        Component.onCompleted: {
            contentColumn.children = []
            var titleRow = Qt.createQmlObject(
                'import QtQuick 2.15; import QtQuick.Controls 2.15; import QtQuick.Layouts 1.15;' +
                'Row { spacing: 12; Layout.fillWidth: true; }',
                contentColumn
            )
            
            var iconText = Qt.createQmlObject(
                'import QtQuick 2.15; Text { text: "' + icon + '"; font.pixelSize: 24; anchors.verticalCenter: parent.verticalCenter; }',
                titleRow
            )
            
            var titleText = Qt.createQmlObject(
                'import QtQuick 2.15; Text { text: "' + title + '"; color: "#ffffff"; font.pixelSize: 18; font.bold: true; anchors.verticalCenter: parent.verticalCenter; }',
                titleRow
            )
            
            titleRow.children = [iconText, titleText]
        }
    }
    
    // GroupBox component
    component GroupBox: Rectangle {
        property string title: ""
        
        color: "transparent"
        border.color: "#ffffff"
        border.width: 1
        border.opacity: 0.1
        radius: 8
        implicitHeight: contentColumn.height + 32
        
        Column {
            id: contentColumn
            anchors.fill: parent
            anchors.margins: 16
            spacing: 12
        }
        
        Component.onCompleted: {
            contentColumn.children = []
            var titleText = Qt.createQmlObject(
                'import QtQuick 2.15; Text { text: "' + title + '"; color: "#9B59B6"; font.pixelSize: 12; font.bold: true; }',
                contentColumn
            )
        }
    }
}
