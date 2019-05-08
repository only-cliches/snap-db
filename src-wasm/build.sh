#!/bin/bash

if [ $1 == "--dev" ]; then 
    echo "Building WASM Index Code (Development)";
    emcc --js-library "index.js" index.cpp -s ALLOW_MEMORY_GROWTH=1 -std=c++11 -s WASM=1 --bind -o ../src/db-index.js;
else
    echo "Building WASM Index Code";
    emcc --js-library "index.js" -O2 index.cpp -s ALLOW_MEMORY_GROWTH=1 -std=c++11 -s WASM=1 --bind -o ../src/db-index.js;
fi
