#include <iostream>
#include <iterator>
#include <map>
#include <unordered_map>
#include <emscripten/bind.h>
#include <vector>
#include <time.h>

using namespace emscripten;

extern "C"
{
    extern int random_int();
}

char *one;

// definition of one index
typedef std::map<double, char *> db_index_sorted;

typedef std::map<std::string, char *> db_index_sorted_str;

typedef std::map<unsigned int, char *> db_index_sorted_int;

// global object containing list of indexes
std::vector<db_index_sorted> index_list_sorted;

std::vector<db_index_sorted_str> index_list_sorted_str;
std::vector<unsigned int> index_list_max_len;

std::vector<db_index_sorted_int> index_list_sorted_int;

int loaded()
{
    return 0;
}

// NORMAL (DOUBLE) FUNCTIONS

int new_index()
{
    int loc = index_list_sorted.size();
    db_index_sorted myIndex;
    index_list_sorted.push_back(myIndex);
    return loc;
}

int add_to_index(int index, double key)
{

    auto p1 = std::make_pair(key, one);
    index_list_sorted[index].insert(p1);

    return 0;
}

int empty_index(int index)
{
    index_list_sorted[index].clear();
    return index;
}

int del_key(int index, double key)
{
    index_list_sorted[index].erase(key);
    return 0;
}

unsigned long get_total(int index)
{
    return index_list_sorted[index].size();
}

std::unordered_map<unsigned int, db_index_sorted::iterator> index_pointers;

int read_index(int index, int reverse)
{
    int loc = random_int();
    while (index_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();
    index_pointers[loc] = it;
    return loc;
}

double read_index_next(int index, int ptr, int reverse, int count)
{

    if (index_pointers.count(ptr) == 0)
        return 0;
    
    if (reverse == 1)
    {
        if (count > 0)
        {
            index_pointers[ptr]--;
        }
        if (index_pointers[ptr] != index_list_sorted[index].begin())
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_pointers[ptr]++;
        }
        if (index_pointers[ptr] != index_list_sorted[index].end())
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            return 0;
        }
    }
}

int read_index_range(int index, double low, double high, int reverse)
{

    db_index_sorted::iterator lower = index_list_sorted[index].lower_bound(low);
    db_index_sorted::iterator upper = index_list_sorted[index].upper_bound(high);

    int loc = random_int();
    while (index_pointers.count(loc) > 0 || index_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_pointers[loc] = lower;
    index_pointers[loc + 1] = upper;

    return loc;
}

double read_index_range_next(int index, int ptr, int reverse, int count)
{
    if (index_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_pointers[ptr + 1]--;
        if (count == 0)
        {
            index_pointers[ptr]--;   
        }
        if (index_pointers[ptr + 1] != index_pointers[ptr])
        {
            return index_pointers[ptr + 1]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            index_pointers.erase(ptr + 1);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_pointers[ptr]++;
        }
        if (index_pointers[ptr] != index_pointers[ptr + 1])
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            index_pointers.erase(ptr + 1);
            return 0;
        }
    }
}

int read_index_offset(int index, int reverse, double offset)
{
    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();
    int loc = random_int();
    while (index_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    index_pointers[loc] = it;
    
    double i = offset;
    while (i--)
    {
        if (reverse)
        {
            index_pointers[loc]--;
        }
        else
        {
            index_pointers[loc]++;
        }
    }

    if (!reverse) {
        index_pointers[loc]--;
    }

    return loc;
}

double read_index_offset_next(int index, int ptr, int reverse, double limit, int count)
{
    if (index_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        if (count > 0)
        {
            index_pointers[ptr]--;
        }
        if (count < limit && index_pointers[ptr] != index_list_sorted[index].begin())
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_pointers[ptr]++;
        }
        if (count < limit && index_pointers[ptr] != index_list_sorted[index].end())
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            index_pointers.erase(ptr);
            return 0;
        }
    }
    return count;
}

// STRING FUNCTIONS

int new_index_str()
{
    int loc = index_list_sorted_str.size();
    db_index_sorted_str myIndex;
    index_list_sorted_str.push_back(myIndex);
    index_list_max_len.push_back(0);
    return loc;
}

int add_to_index_str(int index, std::string key)
{
    auto p1 = std::make_pair(key, one);
    index_list_sorted_str[index].insert(p1);
    return 0;
}

int empty_index_str(int index)
{
    index_list_sorted_str[index].clear();
    index_list_max_len[index] = 0;
    return index;
}

int del_key_str(int index, std::string key)
{
    index_list_sorted_str[index].erase(key);
    return 0;
}

unsigned long get_total_str(int index)
{
    return index_list_sorted_str[index].size();
}

std::unordered_map<unsigned int, db_index_sorted_str::iterator> index_str_pointers;

int read_index_str(int index, int reverse)
{
    int loc = random_int();
    while (index_str_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();
    index_str_pointers[loc] = it;
    return loc;
}

std::string read_index_str_next(int index, int ptr, int reverse, int count)
{
    if (index_str_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        if (count > 0)
        {
            index_str_pointers[ptr]--;
        }
        if (index_str_pointers[ptr] != index_list_sorted_str[index].begin())
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            return "";
        }
    }
    else
    {
        if (count > 0)
        {
            index_str_pointers[ptr]++;
        }
        if (index_str_pointers[ptr] != index_list_sorted_str[index].end())
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            return "";
        }
    }
}

int read_index_range_str(int index, std::string low, std::string high, int reverse)
{

    db_index_sorted_str::iterator lower = index_list_sorted_str[index].lower_bound(low);
    db_index_sorted_str::iterator upper = index_list_sorted_str[index].upper_bound(high);

    int loc = random_int();
    while (index_str_pointers.count(loc) > 0 || index_str_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_str_pointers[loc] = lower;
    index_str_pointers[loc + 1] = upper;

    return loc;
}

std::string read_index_range_str_next(int index, int ptr, int reverse, int count)
{

    if (index_str_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_str_pointers[ptr + 1]--;
        if (count == 0)
        {
            index_str_pointers[ptr]--;   
        }
        if (index_str_pointers[ptr + 1] != index_str_pointers[ptr])
        {
            return index_str_pointers[ptr + 1]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            index_str_pointers.erase(ptr + 1);
            return "";
        }
    }
    else
    {
        if (count > 0)
        {
            index_str_pointers[ptr]++;
        }
        if (index_str_pointers[ptr] != index_str_pointers[ptr + 1])
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            index_str_pointers.erase(ptr + 1);
            return "";
        }
    }
}

int read_index_offset_str(int index, int reverse, double offset)
{
    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();
    int loc = random_int();
    while (index_str_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    index_str_pointers[loc] = it;

    double i = offset;
    while (i--)
    {
        if (reverse)
        {
            index_str_pointers[loc]--;
        }
        else
        {
            index_str_pointers[loc]++;
        }
    }
    return loc;
}

std::string read_index_offset_str_next(int index, int ptr, int reverse, double limit, int count)
{

    if (index_str_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        if (count > 0)
        {
            index_str_pointers[ptr]--;
        }
        if (count < limit && index_str_pointers[ptr] != index_list_sorted_str[index].begin())
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            return "";
        }
    }
    else
    {
        if (count > 0)
        {
            index_str_pointers[ptr]++;
        }
        if (count < limit && index_str_pointers[ptr] != index_list_sorted_str[index].end())
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            index_str_pointers.erase(ptr);
            return "";
        }
    }
    return "";
}

// INTEGER FUNCTIONS

int new_index_int()
{
    int loc = index_list_sorted_int.size();
    db_index_sorted_int myIndex;
    index_list_sorted_int.push_back(myIndex);
    return loc;
}

int add_to_index_int(int index, unsigned int key)
{
    auto p1 = std::make_pair(key, one);
    index_list_sorted_int[index].insert(p1);
    return 0;
}

int empty_index_int(int index)
{
    index_list_sorted_int[index].clear();
    return index;
}

int del_key_int(int index, unsigned int key)
{
    index_list_sorted_int[index].erase(key);
    return 0;
}

unsigned long get_total_int(int index)
{
    return index_list_sorted_int[index].size();
}

std::unordered_map<unsigned int, db_index_sorted_int::iterator> index_int_pointers;

int read_index_int(int index, int reverse)
{
    int loc = random_int();
    while (index_int_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();
    index_int_pointers[loc] = it;
    return loc;
}

int read_index_int_next(int index, int ptr, int reverse, int count)
{
    if (index_int_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        if (count > 0)
        {
            index_int_pointers[ptr]--;
        }
        if (index_int_pointers[ptr] != index_list_sorted_int[index].begin())
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_int_pointers[ptr]++;
        }
        if (index_int_pointers[ptr] != index_list_sorted_int[index].end())
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            return 0;
        }
    }
}

int read_index_range_int(int index, unsigned int low, unsigned int high, int reverse)
{

    db_index_sorted_int::iterator lower = index_list_sorted_int[index].lower_bound(low);
    db_index_sorted_int::iterator upper = index_list_sorted_int[index].upper_bound(high);

    int loc = random_int();
    while (index_int_pointers.count(loc) > 0 || index_int_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_int_pointers[loc] = lower;
    index_int_pointers[loc + 1] = upper;

    return loc;
}

unsigned int read_index_range_int_next(int index, int ptr, int reverse, int count)
{
    if (index_int_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_int_pointers[ptr + 1]--;
        if (count == 0)
        {
            index_int_pointers[ptr]--;   
        }
        if (index_int_pointers[ptr + 1] != index_int_pointers[ptr])
        {
            return index_int_pointers[ptr + 1]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            index_int_pointers.erase(ptr + 1);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_int_pointers[ptr]++;
        }
        if (index_int_pointers[ptr] != index_int_pointers[ptr + 1])
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            index_int_pointers.erase(ptr + 1);
            return 0;
        }
    }
}

int read_index_offset_int(int index, int reverse, double offset)
{
    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();
    int loc = random_int();
    while (index_int_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    index_int_pointers[loc] = it;

    double i = offset;
    while (i--)
    {
        if (reverse)
        {
            index_int_pointers[loc]--;
        }
        else
        {
            index_int_pointers[loc]++;
        }
    }

    if (reverse == 0) {
        index_int_pointers[loc]--;
    }

    return loc;
}

unsigned int read_index_offset_int_next(int index, int ptr, int reverse, double limit, int count)
{
    if (index_int_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        if (count > 0)
        {
            index_int_pointers[ptr]--;
        }
        if (count < limit && index_int_pointers[ptr] != index_list_sorted_int[index].begin())
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            return 0;
        }
    }
    else
    {
        if (count > 0)
        {
            index_int_pointers[ptr]++;
        }
        if (count < limit && index_int_pointers[ptr] != index_list_sorted_int[index].end())
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            index_int_pointers.erase(ptr);
            return 0;
        }
    }
    return count;
}

EMSCRIPTEN_BINDINGS(my_module)
{
    function("loaded", &loaded);

    function("new_index", &new_index);
    function("add_to_index", &add_to_index);
    function("del_key", &del_key);
    function("get_total", &get_total);
    function("read_index_range", &read_index_range);
    function("read_index_range_next", &read_index_range_next);
    function("read_index_offset", &read_index_offset);
    function("read_index_offset_next", &read_index_offset_next);
    function("read_index", &read_index);
    function("read_index_next", &read_index_next);

    function("new_index_str", &new_index_str);
    function("add_to_index_str", &add_to_index_str);
    function("del_key_str", &del_key_str);
    function("get_total_str", &get_total_str);
    function("read_index_range_str", &read_index_range_str);
    function("read_index_range_str_next", &read_index_range_str_next);
    function("read_index_offset_str", &read_index_offset_str);
    function("read_index_offset_str_next", &read_index_offset_str_next);
    function("read_index_str", &read_index_str);
    function("read_index_str_next", &read_index_str_next);

    function("new_index_int", &new_index_int);
    function("add_to_index_int", &add_to_index_int);
    function("del_key_int", &del_key_int);
    function("get_total_int", &get_total_int);
    function("read_index_range_int", &read_index_range_int);
    function("read_index_range_int_next", &read_index_range_int_next);
    function("read_index_offset_int", &read_index_offset_int);
    function("read_index_offset_int_next", &read_index_offset_int_next);
    function("read_index_int", &read_index_int);
    function("read_index_int_next", &read_index_int_next);
}