cmake_minimum_required(VERSION 3.16)
project(Amethyst VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Try to locate Qt6. If it is not on the default search path, pass
# -DCMAKE_PREFIX_PATH=<qt>/lib/cmake/Qt6 or set Qt6_DIR when configuring.
find_package(Qt6 6.5 QUIET COMPONENTS
    Core
    Gui
    Widgets
    Qml
    Quick
    QuickControls2
    Network
)

if(NOT Qt6_FOUND)
    message(STATUS "")
    message(STATUS "Qt6 was not found on the default search path.")
    message(STATUS "You can either:")
    message(STATUS "  1) Run the one-command installer: python3 qt-ui/install.py")
    message(STATUS "  2) Install Qt 6.5+ manually and re-run CMake with")
    message(STATUS "     -DCMAKE_PREFIX_PATH=/path/to/Qt/6.x.x/<arch>")
    message(STATUS "")
    # Re-run as REQUIRED so CMake produces its usual, detailed error.
    find_package(Qt6 6.5 REQUIRED COMPONENTS
        Core Gui Widgets Qml Quick QuickControls2 Network
    )
endif()

set(SOURCES
    src/main.cpp
    src/amaranthlauncher.cpp
    src/amaranthlauncher.h
    src/apiclient.cpp
    src/apiclient.h
)

set(RESOURCES
    resources/amaranth.qrc
)

qt_add_executable(Amethyst
    ${SOURCES}
    ${RESOURCES}
)

target_link_libraries(Amethyst PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
)

target_include_directories(Amethyst PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

# Install the binary.
install(TARGETS Amethyst BUNDLE DESTINATION .)
