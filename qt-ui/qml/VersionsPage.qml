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
    property color releaseColor: "#2ecc71"
    property color snapshotColor: "#f39c12"
    property color oldColor: "#3498db"
    
    property string selectedVersionId: ""
    property string selectedVersionType: "release"
    
    ColumnLayout {
        anchors.fill: parent
        spacing: 20
        
        // Header
        Row {
            Layout.fillWidth: true
            Layout.preferredHeight: 50
            spacing: 16
            
            Text {
                text: "Versions"
                color: textPrimary
                font.pixelSize: 24
                font.bold: true
                anchors.verticalCenter: parent.verticalCenter
            }
            
            Button {
                text: "↻ Refresh"
                flat: true
                anchors.verticalCenter: parent.verticalCenter
                onClicked: launcher.refreshVersions()
            }
            
            Rectangle { Layout.fillWidth: true }
            
            // Search
            TextField {
                id: searchField
                width: 200
                placeholderText: "Search versions..."
                anchors.verticalCenter: parent.verticalCenter
                Material.theme: Material.Dark
                
                onTextChanged: versionList.filterText = text
            }
        }
        
        // Main content
        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 20
            
            // Version list
            Rectangle {
                Layout.preferredWidth: 350
                Layout.fillHeight: true
                color: cardColor
                radius: 12
                
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 0
                    
                    // Filter tabs
                    Row {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 50
                        spacing: 0
                        
                        Rectangle {
                            Layout.fillHeight: true
                            Layout.preferredWidth: parent.width / 3
                            color: versionList.filterType === "all" ? primaryColor : "transparent"
                            
                            Text {
                                text: "All"
                                color: textPrimary
                                anchors.centerIn: parent
                            }
                            
                            MouseArea {
                                anchors.fill: parent
                                onClicked: versionList.filterType = "all"
                            }
                        }
                        
                        Rectangle {
                            Layout.fillHeight: true
                            Layout.preferredWidth: parent.width / 3
                            color: versionList.filterType === "release" ? releaseColor : "transparent"
                            
                            Text {
                                text: "Release"
                                color: textPrimary
                                anchors.centerIn: parent
                            }
                            
                            MouseArea {
                                anchors.fill: parent
                                onClicked: versionList.filterType = "release"
                            }
                        }
                        
                        Rectangle {
                            Layout.fillHeight: true
                            Layout.preferredWidth: parent.width / 3
                            color: versionList.filterType === "snapshot" ? snapshotColor : "transparent"
                            
                            Text {
                                text: "Snapshot"
                                color: textPrimary
                                anchors.centerIn: parent
                            }
                            
                            MouseArea {
                                anchors.fill: parent
                                onClicked: versionList.filterType = "snapshot"
                            }
                        }
                    }
                    
                    // Version list
                    VersionListView {
                        id: versionList
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        
                        onVersionSelected: {
                            selectedVersionId = versionId
                            selectedVersionType = versionType
                        }
                    }
                }
            }
            
            // Version details
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: cardColor
                radius: 12
                
                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 24
                    spacing: 20
                    
                    // Version info
                    Row {
                        spacing: 16
                        Layout.alignment: Qt.AlignHCenter
                        
                        Text {
                            text: selectedVersionId || "Select a version"
                            color: textPrimary
                            font.pixelSize: 28
                            font.bold: true
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        
                        Badge {
                            text: selectedVersionType
                            color: selectedVersionType === "release" ? releaseColor : 
                                   selectedVersionType === "snapshot" ? snapshotColor : oldColor
                        }
                    }
                    
                    Text {
                        text: selectedVersionId ? 
                              "Released: " + getVersionDate(selectedVersionId) : 
                              "Select a version from the list"
                        color: textSecondary
                        font.pixelSize: 14
                        Layout.alignment: Qt.AlignHCenter
                    }
                    
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 1
                        color: "#ffffff"
                        opacity: 0.1
                    }
                    
                    // Actions
                    Column {
                        Layout.fillWidth: true
                        spacing: 16
                        
                        Row {
                            spacing: 16
                            Layout.alignment: Qt.AlignHCenter
                            
                            Button {
                                text: "▶ Install & Play"
                                highlighted: true
                                Material.background: accentColor
                                enabled: selectedVersionId.length > 0
                                width: 200
                                height: 50
                                
                                onClicked: {
                                    launcher.setSelectedVersion(selectedVersionId)
                                    launcher.installVersion(selectedVersionId)
                                }
                            }
                        }
                        
                        // Version path info
                        GroupBox {
                            title: "Installation Info"
                            Layout.fillWidth: true
                            
                            Column {
                                spacing: 8
                                
                                InfoRow {
                                    label: "Game Directory"
                                    value: launcher.dataRoot
                                }
                                
                                InfoRow {
                                    label: "Version ID"
                                    value: selectedVersionId || "-"
                                }
                                
                                InfoRow {
                                    label: "Type"
                                    value: selectedVersionType || "-"
                                }
                            }
                        }
                    }
                    
                    Item { Layout.fillHeight: true }
                    
                    // Memory settings
                    GroupBox {
                        title: "Memory Allocation"
                        Layout.fillWidth: true
                        
                        Column {
                            spacing: 12
                            
                            Row {
                                spacing: 16
                                Layout.alignment: Qt.AlignHCenter
                                
                                Text {
                                    text: "RAM: " + Math.round(memorySlider.value / 1024) + " GB"
                                    color: textPrimary
                                    font.pixelSize: 16
                                    font.bold: true
                                    anchors.verticalCenter: parent.verticalCenter
                                }
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
                                    width: 300
                                    
                                    onMoved: launcher.memoryMb = value
                                }
                                
                                Text {
                                    text: "16 GB"
                                    color: textSecondary
                                    font.pixelSize: 11
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    function getVersionDate(versionId) {
        for (var i = 0; i < launcher.versions.length; i++) {
            var v = launcher.versions[i]
            if (v.id === versionId && v.releaseTime) {
                return v.releaseTime.split("T")[0]
            }
        }
        return "Unknown"
    }
    
    // Version list component
    component VersionListView: ListView {
        property string filterText: ""
        property string filterType: "all"
        
        model: launcher.versions
        clip: true
        
        delegate: Rectangle {
            width: parent ? parent.width : 350
            height: 50
            color: ListView.isCurrentItem ? Qt.lighter(cardColor, 1.1) : "transparent"
            
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
                anchors.leftMargin: 16
                spacing: 12
                anchors.verticalCenter: parent.verticalCenter
                
                Rectangle {
                    width: 8
                    height: 8
                    radius: 4
                    color: modelData.type === "release" ? releaseColor : 
                           modelData.type === "snapshot" ? snapshotColor : oldColor
                    anchors.verticalCenter: parent.verticalCenter
                }
                
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    
                    Text {
                        text: modelData.id
                        color: textPrimary
                        font.pixelSize: 14
                    }
                    
                    Text {
                        text: modelData.type || "unknown"
                        color: textSecondary
                        font.pixelSize: 10
                    }
                }
            }
            
            MouseArea {
                anchors.fill: parent
                onClicked: {
                    ListView.view.currentIndex = index
                    root.selectedVersionId = modelData.id
                    root.selectedVersionType = modelData.type || "release"
                }
            }
        }
    }
    
    // Badge component
    component Badge: Rectangle {
        property string text: ""
        property color color: primaryColor
        
        radius: 4
        color: color
        implicitWidth: text.implicitWidth + 16
        implicitHeight: text.implicitHeight + 8
        
        Text {
            text: parent.text
            color: textPrimary
            font.pixelSize: 10
            font.bold: true
            anchors.centerIn: parent
        }
    }
    
    // GroupBox component
    component GroupBox: Rectangle {
        property string title: ""
        
        color: "transparent"
        border.color: "#ffffff"
        border.width: 0
        radius: 0
        
        Column {
            anchors.fill: parent
            spacing: 12
            
            Text {
                text: title
                color: primaryColor
                font.pixelSize: 12
                font.bold: true
            }
            
            Column {
                anchors.left: parent.left
                anchors.right: parent.right
                spacing: 8
            }
        }
    }
    
    // InfoRow component
    component InfoRow: Row {
        property string label: ""
        property string value: ""
        
        spacing: 12
        
        Text {
            text: label + ":"
            color: textSecondary
            font.pixelSize: 12
            width: 120
        }
        
        Text {
            text: value
            color: textPrimary
            font.pixelSize: 12
            elide: Text.ElideMiddle
            Layout.fillWidth: true
        }
    }
}
