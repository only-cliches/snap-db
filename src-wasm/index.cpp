#include <iostream> 
#include <iterator> 
#include <map>
#include <unordered_map>
#include <emscripten/bind.h>
#include <vector>

using namespace emscripten;

extern "C" {
  extern void loopcb(int cbNum, double key, int done);
  extern void loopcb_str(int cbNum, std::string key, int done);
  extern void loopcb_int(int cbNum, unsigned long key, int done);
}

// definition of one index
typedef std::map<double, unsigned long (*)> db_index_sorted;
typedef std::unordered_map<double, unsigned long (*)> db_index_hash;

typedef std::map<std::string, unsigned long (*)> db_index_sorted_str;
typedef std::unordered_map<std::string, unsigned long (*)> db_index_hash_str;

typedef std::map<unsigned long, unsigned long (*)> db_index_sorted_int;
typedef std::unordered_map<unsigned long, unsigned long (*)> db_index_hash_int;

// global object containing list of indexes
std::vector<db_index_sorted> index_list_sorted;
std::vector<db_index_hash> index_list_hash;

std::vector<db_index_sorted_str> index_list_sorted_str;
std::vector<db_index_hash_str> index_list_hash_str;

std::vector<db_index_sorted_int> index_list_sorted_int;
std::vector<db_index_hash_int> index_list_hash_int;

int loaded() 
{
    return 0;
}


// NORMAL (DOUBLE) FUNCTIONS

int new_index() {
    int loc = index_list_sorted.size();
    db_index_sorted myIndex;
    index_list_sorted.push_back(myIndex);
    db_index_hash myIndex2;
    index_list_hash.push_back(myIndex2);
    return loc;
}


int read_index(int index, int callback, int reverse) {
    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();
    // 4294967295,4294967295

    if (reverse == 1) {
        while(it != index_list_sorted[index].begin()) {
            loopcb(callback, it->first, 0);
            it--;
        }
    } else {
        while(it != index_list_sorted[index].end()) {
            loopcb(callback, it->first, 0);
            it++;
        }
    }
    loopcb(callback, 0, 1);
    return 0;
}

int add_to_index(int index, double key, unsigned long  fileId, unsigned long  fileLocation, unsigned long fileLength) {
    db_index_hash::const_iterator got = index_list_hash[index].find(key);

    // not in list
    if (got == index_list_hash[index].end()) {
        unsigned long * ptr;
        ptr = (unsigned long *) calloc(3, sizeof(unsigned long));
        ptr[0] = fileId;
        ptr[1] = fileLocation;
        ptr[2] = fileLength;
        // double values [2] = {fileId, fileLocation};
        auto p1 = std::make_pair(key, ptr);
        index_list_hash[index].insert(p1);
        index_list_sorted[index].insert(p1);
    } else {
        // found, update in place
        got->second[0] = fileId;
        got->second[1] = fileLocation;
        got->second[2] = fileLength;
    }
    return 0;
}

int empty_index(int index) {
    index_list_hash[index].clear();
    index_list_sorted[index].clear();
    return index;
}

int del_key(int index, double key) {
    index_list_hash[index].erase(key);
    index_list_sorted[index].erase(key);
    return 0;
}

unsigned long get_total(int index) {
    return index_list_hash[index].size();
}


std::string get_from_index(int index, double key) {
    db_index_hash::const_iterator got = index_list_hash[index].find(key);

    // not found
    if (got == index_list_hash[index].end()) {
        return "n";
    // found
    } else {
        return std::to_string(got->second[0]) + "," + std::to_string(got->second[1]) + "," + std::to_string(got->second[2]);
    }
}

int read_index_range(int index, int callback, double low, double high, int reverse) {

    db_index_sorted::iterator lower = index_list_sorted[index].lower_bound(low);
    db_index_sorted::iterator upper = index_list_sorted[index].upper_bound(high);

    if (reverse == 1) {
        db_index_sorted::iterator it = upper;
        while(it != lower) {
            loopcb(callback, it->first, 0);
            it--;
        }
    } else {
        db_index_sorted::iterator it = lower;
        while(it != upper) {
            loopcb(callback, it->first, 0);
            it++;
        }
    }
    loopcb(callback, 0, 1);
    return 0;
}

int read_index_offset(int index, int callback, double limit, double offset, int reverse) {

    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();
    int counter = 0;
    if (reverse == 1) {
        while(it != index_list_sorted[index].begin()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb(callback, it->first, 0);
            }
            it--;
            counter++;
        }
    } else {
        while(it != index_list_sorted[index].end()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb(callback, it->first, 0);
            }
            it++;
            counter++;
        }
    }
    loopcb(callback, 0, 1);
    return 0;
}

// STRING FUNCTIONS

int new_index_str() {
    int loc = index_list_sorted_str.size();
    db_index_sorted_str myIndex;
    index_list_sorted_str.push_back(myIndex);
    db_index_hash_str myIndex2;
    index_list_hash_str.push_back(myIndex2);
    return loc;
}


int read_index_str(int index, int callback, int reverse) {
    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();
    // 4294967295,4294967295

    if (reverse == 1) {
        while(it != index_list_sorted_str[index].begin()) {
            loopcb_str(callback, it->first, 0);
            it--;
        }
    } else {
        while(it != index_list_sorted_str[index].end()) {
            loopcb_str(callback, it->first, 0);
            it++;
        }
    }
    loopcb_str(callback, 0, 1);
    return 0;
}

int add_to_index_str(int index, std::string key, unsigned long  fileId, unsigned long  fileLocation, unsigned long fileLength) {
    db_index_hash_str::const_iterator got = index_list_hash_str[index].find(key);

    // not in list
    if (got == index_list_hash_str[index].end()) {
        unsigned long * ptr;
        ptr = (unsigned long *) calloc(3, sizeof(unsigned long));
        ptr[0] = fileId;
        ptr[1] = fileLocation;
        ptr[2] = fileLength;
        // double values [2] = {fileId, fileLocation};
        auto p1 = std::make_pair(key, ptr);
        index_list_hash_str[index].insert(p1);
        index_list_sorted_str[index].insert(p1);
    } else {
        // found, update in place
        got->second[0] = fileId;
        got->second[1] = fileLocation;
        got->second[2] = fileLength;
    }
    return 0;
}

int empty_index_str(int index) {
    index_list_hash_str[index].clear();
    index_list_sorted_str[index].clear();
    return index;
}

int del_key_str(int index, std::string key) {
    index_list_hash_str[index].erase(key);
    index_list_sorted_str[index].erase(key);
    return 0;
}

unsigned long get_total_str(int index) {
    return index_list_hash_str[index].size();
}


std::string get_from_index_str(int index, std::string key) {
    db_index_hash_str::const_iterator got = index_list_hash_str[index].find(key);

    // not found
    if (got == index_list_hash_str[index].end()) {
        return "n";
    // found
    } else {
        return std::to_string(got->second[0]) + "," + std::to_string(got->second[1]) + "," + std::to_string(got->second[2]);
    }
}

int read_index_range_str(int index, int callback, std::string low, std::string high, int reverse) {

    db_index_sorted_str::iterator lower = index_list_sorted_str[index].lower_bound(low);
    db_index_sorted_str::iterator upper = index_list_sorted_str[index].upper_bound(high);

    if (reverse == 1) {
        db_index_sorted_str::iterator it = upper;
        while(it != lower) {
            loopcb_str(callback, it->first, 0);
            it--;
        }
    } else {
        db_index_sorted_str::iterator it = lower;
        while(it != upper) {
            loopcb_str(callback, it->first, 0);
            it++;
        }
    }
    loopcb_str(callback, 0, 1);
    return 0;
}

int read_index_offset_str(int index, int callback, double limit, double offset, int reverse) {

    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();
    int counter = 0;
    if (reverse == 1) {
        while(it != index_list_sorted_str[index].begin()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb_str(callback, it->first, 0);
            }
            it--;
            counter++;
        }
    } else {
        while(it != index_list_sorted_str[index].end()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb_str(callback, it->first, 0);
            }
            it++;
            counter++;
        }
    }
    loopcb_str(callback, 0, 1);
    return 0;
}


// INTEGER FUNCTIONS

int new_index_int() {
    int loc = index_list_sorted_int.size();
    db_index_sorted_int myIndex;
    index_list_sorted_int.push_back(myIndex);
    db_index_hash_int myIndex2;
    index_list_hash_int.push_back(myIndex2);
    return loc;
}

int read_index_int(int index, int callback, int reverse) {
    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();
    // 4294967295,4294967295

    if (reverse == 1) {
        while(it != index_list_sorted_int[index].begin()) {
            loopcb_int(callback, it->first, 0);
            it--;
        }
    } else {
        while(it != index_list_sorted_int[index].end()) {
            loopcb_int(callback, it->first, 0);
            it++;
        }
    }
    loopcb_int(callback, 0, 1);
    return 0;
}

int add_to_index_int(int index, unsigned long key, unsigned long  fileId, unsigned long  fileLocation, unsigned long fileLength) {
    db_index_hash_int::const_iterator got = index_list_hash_int[index].find(key);

    // not in list
    if (got == index_list_hash_int[index].end()) {
        unsigned long * ptr;
        ptr = (unsigned long *) calloc(3, sizeof(unsigned long));
        ptr[0] = fileId;
        ptr[1] = fileLocation;
        ptr[2] = fileLength;
        // double values [2] = {fileId, fileLocation};
        auto p1 = std::make_pair(key, ptr);
        index_list_hash_int[index].insert(p1);
        index_list_sorted_int[index].insert(p1);
    } else {
        // found, update in place
        got->second[0] = fileId;
        got->second[1] = fileLocation;
        got->second[2] = fileLength;
    }
    return 0;
}

int empty_index_int(int index) {
    index_list_hash_int[index].clear();
    index_list_sorted_int[index].clear();
    return index;
}

int del_key_int(int index, unsigned long key) {
    index_list_hash_int[index].erase(key);
    index_list_sorted_int[index].erase(key);
    return 0;
}

unsigned long get_total_int(int index) {
    return index_list_hash_int[index].size();
}


std::string get_from_index_int(int index, unsigned long key) {
    db_index_hash_int::const_iterator got = index_list_hash_int[index].find(key);

    // not found
    if (got == index_list_hash_int[index].end()) {
        return "n";
    // found
    } else {
        return std::to_string(got->second[0]) + "," + std::to_string(got->second[1]) + "," + std::to_string(got->second[2]);
    }
}

int read_index_range_int(int index, int callback, unsigned long low, unsigned long high, int reverse) {

    db_index_sorted_int::iterator lower = index_list_sorted_int[index].lower_bound(low);
    db_index_sorted_int::iterator upper = index_list_sorted_int[index].upper_bound(high);

    if (reverse == 1) {
        db_index_sorted_int::iterator it = upper;
        while(it != lower) {
            loopcb_int(callback, it->first, 0);
            it--;
        }
    } else {
        db_index_sorted_int::iterator it = lower;
        while(it != upper) {
            loopcb_int(callback, it->first, 0);
            it++;
        }
    }
    loopcb_int(callback, 0, 1);
    return 0;
}

int read_index_offset_int(int index, int callback, double limit, double offset, int reverse) {

    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();
    int counter = 0;
    if (reverse == 1) {
        while(it != index_list_sorted_int[index].begin()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb_int(callback, it->first, 0);
            }
            it--;
            counter++;
        }
    } else {
        while(it != index_list_sorted_int[index].end()) {
            if (counter >= offset && counter < offset + limit) {
                loopcb_int(callback, it->first, 0);
            }
            it++;
            counter++;
        }
    }
    loopcb_int(callback, 0, 1);
    return 0;
}



EMSCRIPTEN_BINDINGS(my_module) {
    function("loaded", &loaded);

    function("new_index", &new_index);
    function("add_to_index", &add_to_index);
    function("get_from_index", &get_from_index);
    function("read_index", &read_index);
    function("del_key", &del_key);
    function("get_total", &get_total);
    function("read_index_range", &read_index_range);
    function("read_index_offset", &read_index_offset);

    function("new_index_str", &new_index_str);
    function("add_to_index_str", &add_to_index_str);
    function("get_from_index_str", &get_from_index_str);
    function("read_index_str", &read_index_str);
    function("del_key_str", &del_key_str);
    function("get_total_str", &get_total_str);
    function("read_index_range_str", &read_index_range_str);
    function("read_index_offset_str", &read_index_offset_str);

    function("new_index_int", &new_index_int);
    function("add_to_index_int", &add_to_index_int);
    function("get_from_index_int", &get_from_index_int);
    function("read_index_int", &read_index_int);
    function("del_key_int", &del_key_int);
    function("get_total_int", &get_total_int);
    function("read_index_range_int", &read_index_range_int);
    function("read_index_offset_int", &read_index_offset_int);
}