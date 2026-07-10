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
                text: "Accounts"
                color: textPrimary
                font.pixelSize: 24
                font.bold: true
                anchors.verticalCenter: parent.verticalCenter
            }
            
            Rectangle { Layout.fillWidth: true }
            
            Button {
                text: "↻ Refresh"
                flat: true
                anchors.verticalCenter: parent.verticalCenter
                onClicked: launcher.refreshAccounts()
            }
        }
        
        // Main content
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 20
            
            // Account list
            Rectangle {
                Layout.preferredWidth: 400
                Layout.fillHeight: true
                color: cardColor
                radius: 12
                
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 0
                    
                    // Header
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 60
                        color: primaryDark
                        radius: 12
                        
                        Row {
                            anchors.fill: parent
                            anchors.leftMargin: 20
                            anchors.rightMargin: 20
                            
                            Text {
                                text: "👤 Offline Accounts"
                                color: textPrimary
                                font.pixelSize: 16
                                font.bold: true
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }
                    }
                    
                    // Account list
                    ListView {
                        id: accountList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        model: launcher.accounts
                        clip: true
                        
                        delegate: AccountDelegate {
                            isSelected: modelData.id === launcher.selectedAccountId
                            
                            onAccountSelected: {
                                launcher.setSelectedAccountId(modelData.id)
                            }
                            
                            onDeleteRequested: {
                                launcher.removeAccount(modelData.id)
                            }
                        }
                        
                        Rectangle {
                            anchors.fill: parent
                            visible: accountList.count === 0
                            
                            Column {
                                anchors.centerIn: parent
                                spacing: 12
                                
                                Text {
                                    text: "👻"
                                    font.pixelSize: 48
                                    anchors.horizontalCenter: parent.horizontalCenter
                                }
                                
                                Text {
                                    text: "No accounts yet"
                                    color: textSecondary
                                    font.pixelSize: 14
                                    anchors.horizontalCenter: parent.horizontalCenter
                                }
                            }
                        }
                    }
                }
            }
            
            // Add account panel
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: cardColor
                radius: 12
                
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 24
                    spacing: 20
                    
                    Text {
                        text: "Add Offline Account"
                        color: textPrimary
                        font.pixelSize: 20
                        font.bold: true
                    }
                    
                    // Info card
                    Rectangle {
                        Layout.fillWidth: true
                        color: Qt.lighter(primaryDark, 1.3)
                        radius: 8
                        opacity: 0.3
                        
                        Row {
                            anchors.fill: parent
                            anchors.margins: 16
                            spacing: 12
                            
                            Text {
                                text: "ℹ️"
                                font.pixelSize: 24
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            
                            Column {
                                anchors.verticalCenter: parent.verticalCenter
                                spacing: 4
                                
                                Text {
                                    text: "Offline Mode Account"
                                    color: textPrimary
                                    font.pixelSize: 14
                                    font.bold: true
                                }
                                
                                Text {
                                    text: "Offline accounts can only join offline servers and single-player worlds."
                                    color: textSecondary
                                    font.pixelSize: 12
                                    wrapMode: Text.WordWrap
                                    width: 300
                                }
                            }
                        }
                    }
                    
                    // Username input
                    Column {
                        spacing: 8
                        
                        Text {
                            text: "Username"
                            color: textSecondary
                            font.pixelSize: 12
                        }
                        
                        TextField {
                            id: usernameField
                            placeholderText: "Enter username..."
                            width: 300
                            Material.theme: Material.Dark
                            
                            onAccepted: addAccount()
                        }
                    }
                    
                    // Add button
                    Button {
                        text: "➕ Add Account"
                        highlighted: true
                        Material.background: successColor
                        enabled: usernameField.text.length > 0
                        width: 200
                        height: 45
                        anchors.horizontalCenter: parent.horizontalCenter
                        
                        onClicked: addAccount()
                    }
                    
                    Item { Layout.fillHeight: true }
                    
                    // Selected account info
                    Rectangle {
                        Layout.fillWidth: true
                        color: primaryDark
                        radius: 8
                        opacity: 0.5
                        visible: launcher.selectedAccountId.length > 0
                        
                        Column {
                            anchors.fill: parent
                            anchors.margins: 16
                            spacing: 8
                            
                            Text {
                                text: "Selected Account"
                                color: textSecondary
                                font.pixelSize: 12
                            }
                            
                            Text {
                                text: getSelectedUsername()
                                color: textPrimary
                                font.pixelSize: 18
                                font.bold: true
                            }
                        }
                    }
                }
            }
        }
    }
    
    function addAccount() {
        var username = usernameField.text.trim()
        if (username.length > 0) {
            launcher.addAccount(username)
            usernameField.text = ""
        }
    }
    
    function getSelectedUsername() {
        for (var i = 0; i < launcher.accounts.length; i++) {
            var acc = launcher.accounts[i]
            if (acc.id === launcher.selectedAccountId) {
                return acc.username || "Unknown"
            }
        }
        return "None"
    }
    
    // Account delegate component
    component AccountDelegate: Rectangle {
        property bool isSelected: false
        property string accountId: modelData.id || ""
        property string username: modelData.username || "Unknown"
        property string uuid: modelData.uuid || ""
        
        signal accountSelected()
        signal deleteRequested()
        
        width: parent ? parent.width : 400
        height: 70
        color: isSelected ? Qt.lighter(cardColor, 1.1) : "transparent"
        radius: 0
        
        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 1
            color: "#ffffff"
            opacity: 0.05
        }
        
        Row {
            anchors.fill: parent
            anchors.leftMargin: 20
            anchors.rightMargin: 20
            spacing: 16
            
            // Avatar
            Rectangle {
                width: 50
                height: 50
                radius: 25
                color: primaryColor
                anchors.verticalCenter: parent.verticalCenter
                
                Text {
                    text: username.charAt(0).toUpperCase()
                    color: textPrimary
                    font.pixelSize: 24
                    font.bold: true
                    anchors.centerIn: parent
                }
            }
            
            // Info
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                
                Text {
                    text: username
                    color: textPrimary
                    font.pixelSize: 16
                    font.bold: true
                }
                
                Text {
                    text: uuid ? uuid.substring(0, 8) + "..." : "No UUID"
                    color: textSecondary
                    font.pixelSize: 11
                }
                
                Row {
                    spacing: 4
                    
                    Rectangle {
                        width: 6
                        height: 6
                        radius: 3
                        color: successColor
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    
                    Text {
                        text: "Offline"
                        color: textSecondary
                        font.pixelSize: 10
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
            }
            
            Rectangle { Layout.fillWidth: true }
            
            // Actions
            Row {
                spacing: 8
                anchors.verticalCenter: parent.verticalCenter
                
                Button {
                    text: isSelected ? "✓ Selected" : "Select"
                    flat: true
                    highlighted: isSelected
                    Material.background: isSelected ? primaryColor : undefined
                    
                    onClicked: accountSelected()
                }
                
                Button {
                    text: "🗑️"
                    flat: true
                    ToolTip.text: "Delete account"
                    
                    onClicked: deleteRequested()
                }
            }
        }
        
        MouseArea {
            anchors.fill: parent
            onClicked: accountSelected()
        }
    }
}
