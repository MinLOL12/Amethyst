import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Controls.Material

Popup {
    id: root
    modal: true
    dim: true
    closePolicy: errorMessage.length > 0 || isComplete ? Popup.CloseOnEscape : Popup.NoAutoClose

    property string versionId: ""
    property string errorMessage: ""
    property bool isInstalling: false
    property bool isComplete: false

    // Live progress comes straight from the launcher controller.
    property int downloadProgress: launcher.downloadProgress
    property string downloadLabel: launcher.downloadLabel

    width: 520
    height: 340
    anchors.centerIn: parent

    background: Rectangle {
        color: cardColor
        radius: 16
        border.color: primaryColor
        border.width: 2
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 20

        // Header
        Row {
            spacing: 12
            Layout.alignment: Qt.AlignHCenter

            Text {
                text: "💎"
                font.pixelSize: 32
                anchors.verticalCenter: parent.verticalCenter
            }

            Column {
                spacing: 4

                Text {
                    text: isComplete ? "Installation Complete!" :
                          errorMessage.length > 0 ? "Installation Failed" : "Installing Version"
                    color: textPrimary
                    font.pixelSize: 20
                    font.bold: true
                    anchors.horizontalCenter: parent.horizontalCenter
                }

                Text {
                    text: versionId
                    color: primaryColor
                    font.pixelSize: 16
                    anchors.horizontalCenter: parent.horizontalCenter
                }
            }
        }

        // Progress area
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 140
            color: backgroundColor
            radius: 12

            Column {
                anchors.centerIn: parent
                spacing: 16
                width: parent.width - 32

                // Status icon
                Text {
                    text: isComplete ? "✅" : (errorMessage.length > 0 ? "❌" : "⏳")
                    font.pixelSize: 48
                    anchors.horizontalCenter: parent.horizontalCenter
                }

                // Status text
                Text {
                    text: isComplete ? "Ready to play!" :
                          errorMessage.length > 0 ? errorMessage :
                          downloadLabel.length > 0 ? downloadLabel : "Preparing..."
                    color: isComplete ? successColor :
                           errorMessage.length > 0 ? accentColor : textSecondary
                    font.pixelSize: 14
                    anchors.horizontalCenter: parent.horizontalCenter
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                    width: parent.width
                }

                // Progress bar
                ProgressBar {
                    width: 320
                    value: downloadProgress / 100
                    visible: !isComplete && errorMessage.length === 0
                    Material.accent: primaryColor
                    anchors.horizontalCenter: parent.horizontalCenter
                }

                // Progress text
                Text {
                    text: downloadProgress + "%"
                    color: textPrimary
                    font.pixelSize: 24
                    font.bold: true
                    visible: !isComplete && errorMessage.length === 0
                    anchors.horizontalCenter: parent.horizontalCenter
                }
            }
        }

        // Action buttons
        Row {
            spacing: 16
            Layout.alignment: Qt.AlignHCenter

            Button {
                text: isComplete ? "🎮 Play Now" : "Retry"
                highlighted: true
                Material.background: isComplete ? successColor : primaryColor
                width: 150
                height: 45
                visible: isComplete || errorMessage.length > 0

                onClicked: {
                    if (isComplete) {
                        launcher.launchVersion()
                        root.close()
                    } else {
                        launcher.installVersion(versionId)
                    }
                }
            }

            Button {
                text: "Close"
                flat: true
                width: 100

                onClicked: root.close()
            }
        }
    }

    // Colors
    property color primaryColor: "#9B59B6"
    property color primaryDark: "#8E44AD"
    property color textPrimary: "#ffffff"
    property color textSecondary: "#a0aec0"
    property color cardColor: "#1f2937"
    property color backgroundColor: "#16213e"
    property color accentColor: "#E74C3C"
    property color successColor: "#2ecc71"
}
