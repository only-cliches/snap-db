import { runTests } from "./test";
import { SnapDB } from ".";

const db_str1 = () => new SnapDB<string>({ dir: "testDB1", key: "string", mainThread: true });
const db_int1 = () => new SnapDB<number>({ dir: "testDB2", key: "int", mainThread: true });
const db_flt1 = () => new SnapDB<number>({ dir: "testDB3", key: "float", mainThread: true });
const db_any1 = () => new SnapDB<number>({ dir: "testDB4", key: "any", mainThread: true });

runTests("SnapDB Tests (Single Thread)", db_str1, db_int1, db_flt1, db_any1);