import { describe, expect, it } from "vitest";
import { WIP_OID } from "../state/graph";
import { firstRowOid } from "./firstRow";

describe("firstRowOid", () => {
  it("prefers WIP", () => expect(firstRowOid(true, [{ oid: "a" }])).toBe(WIP_OID));
  it("falls back to the first row", () => expect(firstRowOid(false, [{ oid: "a" }])).toBe("a"));
  it("null when empty", () => expect(firstRowOid(false, [])).toBeNull());
});
