#include <iostream>
#include <iterator>
#include <map>
#include <unordered_map>
#include <emscripten/bind.h>
#include <vector>
#include <time.h>
#include "sqlite3.h"

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

struct snapp_db
{
    sqlite3 *db;
    sqlite3_stmt *put;
    sqlite3_stmt *del;
    sqlite3_stmt *get;
    sqlite3_stmt *update;
    int keyType;
    int index;
};

std::unordered_map<int, snapp_db> databases;
std::unordered_map<int, sqlite3_stmt *> database_cursors;

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

unsigned int get_total(int index)
{
    return index_list_sorted[index].size();
}

std::unordered_map<unsigned int, db_index_sorted::iterator> index_pointers;

std::string read_index(int index, int reverse)
{
    if (index_list_sorted[index].size() == 0) return "";
    int loc = random_int();
    while (index_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();

    index_pointers[loc] = it;
    return std::to_string(loc) + "," + std::to_string(index_list_sorted[index].size());
}

double read_index_next(int index, int ptr, int reverse, int count)
{

    if (index_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_pointers[ptr]--;

        if (index_pointers[ptr] != index_list_sorted[index].begin())
        {
            return index_pointers[ptr]->first;
        }
        else
        {
            double lastElem = index_pointers[ptr]->first;
            index_pointers.erase(ptr);
            return lastElem;
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

std::string read_index_range(int index, double low, double high, int reverse)
{
    if (index_list_sorted[index].size() == 0) return "";
    db_index_sorted::iterator lower = index_list_sorted[index].lower_bound(low);
    db_index_sorted::iterator upper = index_list_sorted[index].upper_bound(high);

    int count = 0;
    db_index_sorted::iterator lower2 = lower;
    while (lower2 != upper)
    {
        lower2++;
        count++;
    }

    int loc = random_int();
    while (index_pointers.count(loc) > 0 || index_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_pointers[loc] = lower;
    index_pointers[loc + 1] = upper;

    return std::to_string(loc) + "," + std::to_string(count);
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
    if (index_list_sorted[index].size() == 0) return 0;

    db_index_sorted::iterator it = reverse == 1 ? index_list_sorted[index].end() : index_list_sorted[index].begin();
    int loc = random_int();
    while (index_pointers.count(loc) > 0 && loc != 0)
    {
        loc = random_int();
    }
    index_pointers[loc] = it;

    int i = 0;
    while (i < offset)
    {
        if (reverse)
        {
            index_pointers[loc]--;
        }
        else
        {
            index_pointers[loc]++;
        }
        i++;
    }

    if (!reverse)
    {
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

unsigned int get_total_str(int index)
{
    return index_list_sorted_str[index].size();
}

std::unordered_map<unsigned int, db_index_sorted_str::iterator> index_str_pointers;

std::string read_index_str(int index, int reverse)
{
    if (index_list_sorted_str[index].size() == 0) return "";

    int loc = random_int();
    while (index_str_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();

    index_str_pointers[loc] = it;
    return std::to_string(loc) + "," + std::to_string(index_list_sorted_str[index].size());
}

std::string read_index_str_next(int index, int ptr, int reverse, int count)
{
    if (index_str_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_str_pointers[ptr]--;
        if (index_str_pointers[ptr] != index_list_sorted_str[index].begin())
        {
            return index_str_pointers[ptr]->first;
        }
        else
        {
            std::string lastElement = index_str_pointers[ptr]->first;
            index_str_pointers.erase(ptr);
            return lastElement;
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

std::string read_index_range_str(int index, std::string low, std::string high, int reverse)
{

    if (index_list_sorted_str[index].size() == 0) return "";

    db_index_sorted_str::iterator lower = index_list_sorted_str[index].lower_bound(low);
    db_index_sorted_str::iterator upper = index_list_sorted_str[index].upper_bound(high);

    int count = 0;
    db_index_sorted_str::iterator lower2 = lower;
    while (lower2 != upper)
    {
        lower2++;
        count++;
    }

    int loc = random_int();
    while (index_str_pointers.count(loc) > 0 || index_str_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_str_pointers[loc] = lower;
    index_str_pointers[loc + 1] = upper;

    return std::to_string(loc) + "," + std::to_string(count);
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

    if (index_list_sorted_str[index].size() == 0) return 0;
    db_index_sorted_str::iterator it = reverse == 1 ? index_list_sorted_str[index].end() : index_list_sorted_str[index].begin();
    int loc = random_int();
    while (index_str_pointers.count(loc) > 0 && loc != 0)
    {
        loc = random_int();
    }
    index_str_pointers[loc] = it;

    int i = 0;
    while (i < offset)
    {
        if (reverse)
        {
            index_str_pointers[loc]--;
        }
        else
        {
            index_str_pointers[loc]++;
        }
        i++;
    }

    if (!reverse)
    {
        index_str_pointers[loc]--;
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

unsigned int get_total_int(int index)
{
    return index_list_sorted_int[index].size();
}

std::unordered_map<unsigned int, db_index_sorted_int::iterator> index_int_pointers;

std::string read_index_int(int index, int reverse)
{
    if (index_list_sorted_int[index].size() == 0) return "";

    int loc = random_int();
    while (index_int_pointers.count(loc) > 0)
    {
        loc = random_int();
    }
    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();

    index_int_pointers[loc] = it;
    return std::to_string(loc) + "," + std::to_string(index_list_sorted_int[index].size());
}

int read_index_int_next(int index, int ptr, int reverse, int count)
{
    if (index_int_pointers.count(ptr) == 0)
        return 0;

    if (reverse == 1)
    {
        index_int_pointers[ptr]--;
        if (index_int_pointers[ptr] != index_list_sorted_int[index].begin())
        {
            return index_int_pointers[ptr]->first;
        }
        else
        {
            int lastElem = index_int_pointers[ptr]->first;
            index_int_pointers.erase(ptr);
            return lastElem;
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

std::string read_index_range_int(int index, unsigned int low, unsigned int high, int reverse)
{
    if (index_list_sorted_int[index].size() == 0) return "";

    db_index_sorted_int::iterator lower = index_list_sorted_int[index].lower_bound(low);
    db_index_sorted_int::iterator upper = index_list_sorted_int[index].upper_bound(high);

    int count = 0;
    db_index_sorted_int::iterator lower2 = lower;
    while (lower2 != upper)
    {
        lower2++;
        count++;
    }

    int loc = random_int();
    while (index_int_pointers.count(loc) > 0 || index_int_pointers.count(loc + 1) > 0)
    {
        loc = random_int();
    }
    index_int_pointers[loc] = lower;
    index_int_pointers[loc + 1] = upper;

    return std::to_string(loc) + "," + std::to_string(count);
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
    if (index_list_sorted_int[index].size() == 0) return 0;
    db_index_sorted_int::iterator it = reverse == 1 ? index_list_sorted_int[index].end() : index_list_sorted_int[index].begin();
    int loc = random_int();
    while (index_int_pointers.count(loc) > 0 && loc != 0)
    {
        loc = random_int();
    }
    index_int_pointers[loc] = it;

    int i = 0;
    while (i < offset)
    {
        if (reverse)
        {
            index_int_pointers[loc]--;
        }
        else
        {
            index_int_pointers[loc]++;
        }
        i++;
    }

    if (reverse == 0)
    {
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

// database code

std::string database_create(std::string file, int keyType)
{
    struct snapp_db thisDB;

    thisDB.keyType = keyType;
    int loc = random_int();
    while (databases.count(loc) > 0)
    {
        loc = random_int();
    }

    const char *cstr = file.c_str();

    int open = sqlite3_open(cstr, &thisDB.db);
    if (open != SQLITE_OK)
    {
        printf("ERROR opening DB: %s\n", sqlite3_errmsg(thisDB.db));
        return "";
    }
    std::string keyT = (keyType == 1 ? "TEXT" : "REAL");
    std::string newTable = "CREATE TABLE IF NOT EXISTS 'values' (id " + keyT + " PRIMARY KEY UNIQUE, data TEXT);";

    const char *sqlStr = newTable.c_str();

    sqlite3_stmt *ppStmt;

    sqlite3_prepare_v2(thisDB.db, sqlStr, -1, &ppStmt, NULL);

    int result = sqlite3_step(ppStmt);
    sqlite3_finalize(ppStmt);
    if (result != SQLITE_DONE)
    {
        printf("DB Error: %s\n", sqlite3_errmsg(thisDB.db));
        return "";
    }

    // insert statement
    std::string insertStmt = "INSERT INTO 'values' (id, data) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET data = ?;";
    const char *insertStr = insertStmt.c_str();
    sqlite3_prepare_v2(thisDB.db, insertStr, -1, &thisDB.put, NULL);

    // update statement
    std::string updateStmt = "UPDATE 'values' SET data = ? WHERE id = ?";
    const char *updateStr = updateStmt.c_str();
    sqlite3_prepare_v2(thisDB.db, updateStr, -1, &thisDB.update, NULL);

    // get statement
    std::string selectStmt = "SELECT data FROM 'values' WHERE id=?;";
    const char *selectStr = selectStmt.c_str();
    sqlite3_prepare_v2(thisDB.db, selectStr, -1, &thisDB.get, NULL);

    // del statement
    std::string delStmt = "DELETE FROM 'values' WHERE id = ?;";
    const char *delStr = delStmt.c_str();
    sqlite3_prepare_v2(thisDB.db, delStr, -1, &thisDB.del, NULL);

    switch (keyType)
    {
    case 0: // double
        thisDB.index = new_index();
        break;
    case 1: // string
        thisDB.index = new_index_str();
        break;
    case 2: // integer
        thisDB.index = new_index_int();
        break;
    }
    databases[loc] = thisDB;

    return std::to_string(loc) + "," + std::to_string(thisDB.index);
}

int database_put(int db, int isNew, std::string key, std::string value)
{
    struct snapp_db thisDB = databases[db];

    const char *keyStr = key.c_str();
    const char *valueStr = value.c_str();
    int result;

    if (isNew)
    {
        sqlite3_clear_bindings(thisDB.put);
        sqlite3_reset(thisDB.put);

        sqlite3_bind_text(thisDB.put, 1, keyStr, -1, SQLITE_STATIC);
        sqlite3_bind_text(thisDB.put, 2, valueStr, -1, SQLITE_STATIC);
        sqlite3_bind_text(thisDB.put, 3, valueStr, -1, SQLITE_STATIC);

        result = sqlite3_step(thisDB.put);
    }
    else
    {
        sqlite3_clear_bindings(thisDB.update);
        sqlite3_reset(thisDB.update);

        sqlite3_bind_text(thisDB.update, 1, valueStr, -1, SQLITE_STATIC);
        sqlite3_bind_text(thisDB.update, 2, keyStr, -1, SQLITE_STATIC);
        
        result = sqlite3_step(thisDB.update);
    }

    if (result != SQLITE_DONE)
    {
        printf("DB Error: %s\n", sqlite3_errmsg(thisDB.db));
        return 1;
    }

    return 0;
}

std::string database_get(int db, std::string key)
{

    struct snapp_db thisDB = databases[db];

    const char *keyStr = key.c_str();

    sqlite3_clear_bindings(thisDB.get);
    sqlite3_reset(thisDB.get);

    sqlite3_bind_text(thisDB.get, 1, keyStr, -1, SQLITE_STATIC);

    int rc = sqlite3_step(thisDB.get);

    if (rc == SQLITE_ROW)
    {
        std::string result = std::string(reinterpret_cast<const char *>(
            sqlite3_column_text(thisDB.get, 0)));
        return result;
    }
    else
    {
        return "";
    }
}

int database_del(int db, std::string key)
{
    struct snapp_db thisDB = databases[db];

    const char *keyStr = key.c_str();

    sqlite3_clear_bindings(thisDB.del);
    sqlite3_reset(thisDB.del);

    sqlite3_bind_text(thisDB.del, 1, keyStr, -1, SQLITE_STATIC);

    int result = sqlite3_step(thisDB.del);

    if (result != SQLITE_DONE)
    {
        printf("DB Error: %s\n", sqlite3_errmsg(thisDB.db));
        return 1;
    }

    return 0;
}

int database_close(int db)
{
    sqlite3_finalize(databases[db].put);
    sqlite3_finalize(databases[db].del);
    sqlite3_finalize(databases[db].get);
    sqlite3_finalize(databases[db].update);
    sqlite3_close(databases[db].db);

    databases.erase(db);
    return 0;
}

std::string database_cursor(int db)
{

    struct snapp_db thisDB = databases[db];

    std::string selectStmt = "SELECT id FROM 'values';";

    const char *sqlStr = selectStmt.c_str();

    sqlite3_stmt *ppStmt;

    sqlite3_prepare_v2(thisDB.db, sqlStr, -1, &ppStmt, NULL);

    int loc = random_int();
    while (database_cursors.count(loc) > 0)
    {
        loc = random_int();
    }
    database_cursors[loc] = ppStmt;

    std::string countStmt = "SELECT COUNT(*) FROM 'values';";

    const char *ctStr = countStmt.c_str();

    sqlite3_stmt *cntStmt;

    sqlite3_prepare_v2(thisDB.db, ctStr, -1, &cntStmt, NULL);
    sqlite3_step(cntStmt);

    std::string result = std::string(reinterpret_cast<const char *>(
            sqlite3_column_text(cntStmt, 0)));

    sqlite3_finalize(cntStmt);

    return std::to_string(loc) + "," + result;
}

std::string database_cursor_next(int db, int cursor, int count)
{
    struct snapp_db thisDB = databases[db];

    if (!database_cursors[cursor])
    {
        return "";
    }

    sqlite3_stmt *ppStmt = database_cursors[cursor];

    int next = sqlite3_step(ppStmt);

    if (next == SQLITE_ROW)
    {
        std::string result = std::string(reinterpret_cast<const char *>(
            sqlite3_column_text(ppStmt, 0)));
        return result;
    }
    else
    {
        sqlite3_finalize(ppStmt);
        database_cursors.erase(cursor);
        return "";
    }
}

int database_clear(int db)
{
    struct snapp_db thisDB = databases[db];
    std::string delAll = "DELETE FROM 'values';";

    const char *sqlStr = delAll.c_str();

    sqlite3_stmt *ppStmt;

    sqlite3_prepare_v2(thisDB.db, sqlStr, -1, &ppStmt, NULL);

    int result = sqlite3_step(ppStmt);
    sqlite3_finalize(ppStmt);
    if (result != SQLITE_DONE)
    {
        printf("DB Error: %s\n", sqlite3_errmsg(thisDB.db));
        return 1;
    }
    return 0;
}

int database_start_tx(int db)
{
    struct snapp_db thisDB = databases[db];
    sqlite3_exec(thisDB.db, "BEGIN TRANSACTION;", NULL, NULL, NULL);
    return 0;
}

int database_end_tx(int db)
{
    struct snapp_db thisDB = databases[db];
    sqlite3_exec(thisDB.db, "COMMIT;", NULL, NULL, NULL);
    return 0;
}

EMSCRIPTEN_BINDINGS(my_module)
{
    function("loaded", &loaded);

    function("new_index", &new_index);
    function("add_to_index", &add_to_index);
    function("del_key", &del_key);
    function("get_total", &get_total);
    function("empty_index", &empty_index);
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
    function("empty_index_str", &empty_index_str);
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
    function("empty_index_int", &empty_index_int);
    function("read_index_range_int", &read_index_range_int);
    function("read_index_range_int_next", &read_index_range_int_next);
    function("read_index_offset_int", &read_index_offset_int);
    function("read_index_offset_int_next", &read_index_offset_int_next);
    function("read_index_int", &read_index_int);
    function("read_index_int_next", &read_index_int_next);

    function("database_create", &database_create);
    function("database_put", &database_put);
    function("database_get", &database_get);
    function("database_del", &database_del);
    function("database_close", &database_close);
    function("database_cursor", &database_cursor);
    function("database_cursor_next", &database_cursor_next);
    function("database_start_tx", &database_start_tx);
    function("database_end_tx", &database_end_tx);
    function("database_clear", &database_clear);
}