#!/bin/bash

emcc -shared lsm_ckpt.c lsm_file.c lsm_log.c lsm_main.c lsm_mem.c lsm_mutex.c lsm_shared.c lsm_sorted.c lsm_str.c lsm_tree.c lsm_unix.c lsm_varint.c lsm_vtab.c -Os -s LINKABLE=1 -s EXPORT_ALL=1 -o lsm.so