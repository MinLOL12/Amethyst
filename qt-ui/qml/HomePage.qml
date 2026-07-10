import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
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
    
    ScrollView {
        anchors.fill: parent
        anchors.margins: 10
        
        Column {
            anchors.fill: parent
            spacing: 24
            padding: 10
            
            // Welcome card
            Card {
                title: "Welcome to Amethyst"
                icon: "💎"
                
                Column {
                    width: parent.width
                    spacing: 12
                    
                    Text {
                        text: "A dark purple Minecraft vanilla launcher"
                        color: textSecondary
                        font.pixelSize: 14
                        wrapMode: Text.WordWrap
                    }
                    
                    Row {
                        spacing: 16
                        
                        Button {
                            text: "Browse Versions"
                            highlighted: true
                            Material.background: primaryColor
                            onClicked: launcher.navigateTo("versions")
                        }
                        
                        Button {
                            text: "Manage Accounts"
                            onClicked: launcher.navigateTo("accounts")
                        }
                    }
                }
            }
            
            // News section
            Card {
                title: "Latest News"
                icon: "📰"
                
                Column {
                    width: parent.width
                    spacing: 16
                    
                    Repeater {
                        model: launcher.newsModel
                        
                        NewsItem {
                            title: modelData.title || "Minecraft News"
                            body: modelData.body || ""
                            date: modelData.date || ""
                            link: modelData.link || ""
                        }
                    }
                    
                    Text {
                        text: "No news available. Connect to the internet to see latest updates."
                        color: textSecondary
                        font.pixelSize: 12
                        visible: launcher.newsModel.count === 0
                        anchors.horizontalCenter: parent.horizontalCenter
                    }
                }
            }
            
            // Quick launch section
            Card {
                title: "Quick Launch"
                icon: "🚀"
                
                Column {
                    width: parent.width
                    spacing: 16
                    
                    Row {
                        spacing: 16
                        anchors.horizontalCenter: parent.horizontalCenter
                        
                        ComboBox {
                            id: quickVersionSelect
                            width: 250
                            model: launcher.versions
                            textRole: "id"
                            placeholderText: "Select version..."
                            
                            delegate: ItemDelegate {
                                width: quickVersionSelect.width
                                text: modelData.id
                                highlighted: quickVersionSelect.highlightedIndex === index
                            }
                        }
                        
                        Button {
                            text: "Launch"
                            highlighted: true
                            Material.background: accentColor
                            enabled: quickVersionSelect.currentIndex >= 0
                            
                            onClicked: {
                                if (quickVersionSelect.currentIndex >= 0) {
                                    var version = launcher.versions[quickVersionSelect.currentIndex]
                                    launcher.setSelectedVersion(version.id)
                                    launcher.launchVersion()
                                }
                            }
                        }
                    }
                    
                    Row {
                        spacing: 12
                        anchors.horizontalCenter: parent.horizontalCenter
                        
                        Label {
                            text: "Memory:"
                            color: textSecondary
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        
                        Slider {
                            id: quickMemorySlider
                            from: 512
                            to: 16384
                            stepSize: 256
                            value: launcher.memoryMb
                            width: 200
                            
                            onMoved: launcher.memoryMb = value
                        }
                        
                        Label {
                            text: Math.round(quickMemorySlider.value / 1024) + " GB"
                            color: textPrimary
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                }
            }
        }
    }
    
    // News model placeholder
    property ListModel newsModel: ListModel {}
    
    // News item component
    component NewsItem: Rectangle {
        property string title: ""
        property string body: ""
        property string date: ""
        property string link: ""
        
        width: parent ? parent.width - 20 : 600
        height: body ? implicitHeight : 0
        color: Qt.lighter(cardColor, 1.05)
        radius: 8
        clip: true
        
        Column {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 8
            
            Row {
                spacing: 8
                anchors.horizontalCenter: parent.horizontalCenter
                
                Text {
                    text: title
                    color: textPrimary
                    font.pixelSize: 14
                    font.bold: true
                    wrapMode: Text.WordWrap
                    anchors.verticalCenter: parent.verticalCenter
                }
                
                Text {
                    text: date
                    color: textSecondary
                    font.pixelSize: 11
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            
            Text {
                text: body
                color: textSecondary
                font.pixelSize: 12
                wrapMode: Text.WordWrap
                maximumLineCount: 3
                elide: Text.ElideRight
            }
            
            Button {
                text: "Read More"
                flat: true
                anchors.horizontalCenter: parent.horizontalCenter
                visible: link.length > 0
                
                onClicked: {
                    Qt.openUrlExternally(link)
                }
            }
        }
    }
    
    // Card component
    component Card: Rectangle {
        property string title: ""
        property string icon: ""
        
        width: parent ? parent.width : 700
        implicitHeight: contentColumn.height + 80
        color: cardColor
        radius: 12
        
        Column {
            id: contentColumn
            anchors.fill: parent
            anchors.margins: 20
            spacing: 16
            
            Row {
                spacing: 12
                
                Text {
                    text: icon
                    font.pixelSize: 24
                    anchors.verticalCenter: parent.verticalCenter
                }
                
                Text {
                    text: title
                    color: textPrimary
                    font.pixelSize: 18
                    font.bold: true
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            
            Rectangle {
                width: parent.width
                height: 1
                color: "#ffffff"
                opacity: 0.1
            }
        }
    }
}
