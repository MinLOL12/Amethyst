cmake_minimum_required(VERSION 3.16)
project(Amethyst VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Qt6 with required modules
find_package(Qt6 6.5 REQUIRED COMPONENTS 
    Core 
    Gui 
    Widgets 
    Qml 
    Quick 
    QuickControls2 
    Network
)

# Application sources
set(SOURCES
    src/main.cpp
    src/amaranthlauncher.cpp
    src/amaranthlauncher.h
    src/apiclient.cpp
    src/apiclient.h
)

# QML files
set(QML_FILES
    qml/main.qml
    qml/HomePage.qml
    qml/VersionsPage.qml
    qml/AccountsPage.qml
    qml/SettingsPage.qml
    qml/DownloadDialog.qml
)

# Resources
set(RESOURCES
    resources/amaranth.qrc
)

qt_add_executable(Amethyst
    ${SOURCES}
    ${QML_FILES}
    ${RESOURCES}
)

# Link Qt libraries
target_link_libraries(Amethyst PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
)

# Include directories
target_include_directories(Amethyst PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

# Install targets
install(TARGETS Amethyst BUNDLE DESTINATION .)
install(FILES ${QML_FILES} DESTINATION qml)
