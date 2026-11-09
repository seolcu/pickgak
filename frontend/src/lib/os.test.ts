import { describe, expect, it } from "vitest";
import { isRecommended, orderFiles, type ReleaseFile } from "./os";

const files: ReleaseFile[] = [
  { name: "PickGak-2.6.2-1.x86_64.rpm", kind: "rpm", os: "linux" },
  { name: "PickGak_2.6.2_amd64.deb", kind: "deb", os: "linux" },
  { name: "PickGak_2.6.2_amd64.AppImage", kind: "appimage", os: "linux" },
  { name: "PickGak_2.6.2_x64-setup.exe", kind: "exe", os: "windows" },
];

describe("download order", () => {
  it("puts the current OS first and native packages before the AppImage", () => {
    expect(orderFiles(files, "windows").map((f) => f.kind)).toEqual(["exe", "rpm", "deb", "appimage"]);
    expect(orderFiles(files, "linux").map((f) => f.kind)).toEqual(["rpm", "deb", "appimage", "exe"]);
    expect(orderFiles(files, "mac").map((f) => f.kind)).toEqual(["rpm", "deb", "appimage", "exe"]);
  });

  it("keeps the server order when the OS is unknown and prefers Linux", () => {
    expect(orderFiles(files, "other").map((f) => f.kind)).toEqual(["rpm", "deb", "appimage", "exe"]);
  });

  it("marks the native package of the current OS as recommended", () => {
    const [rpm, , , exe] = files;
    expect(isRecommended(rpm, "linux")).toBe(true);
    expect(isRecommended(exe, "linux")).toBe(false);
    expect(isRecommended(exe, "windows")).toBe(true);
    expect(isRecommended(files[2], "linux")).toBe(false);
  });
});
