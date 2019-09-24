import { runTests } from "./test";
import { SnapDB } from ".";

const db_str1 = () => new SnapDB<string>({ dir: "testDB1", key: "string", mainThread: false });
const db_int1 = () => new SnapDB<number>({ dir: "testDB2", key: "int", mainThread: false });
const db_flt1 = () => new SnapDB<number>({ dir: "testDB3", key: "float", mainThread: false });
const db_any1 = () => new SnapDB<number>({ dir: "testDB4", key: "any", mainThread: false });

runTests("SnapDB Tests (Multi Thread)", db_str1, db_int1, db_flt1, db_any1);