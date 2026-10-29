cmake_minimum_required(VERSION 3.22.1)
project(halo_tdlib LANGUAGES CXX)

add_library(tdjson SHARED IMPORTED)
set_target_properties(tdjson PROPERTIES IMPORTED_LOCATION
    "${CMAKE_CURRENT_LIST_DIR}/../jniLibs/${ANDROID_ABI}/libtdjson.so")

add_library(halo_tdlib SHARED halo_tdlib.cpp)
target_compile_features(halo_tdlib PRIVATE cxx_std_17)
target_link_libraries(halo_tdlib PRIVATE tdjson)
