import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api", () => {
  it("includes the browser IANA timezone in brief requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.brief();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      timeZone?: string;
    };
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("downloads an export with the server-provided filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ records: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-disposition": 'attachment; filename="clement-export.json"',
        },
      }),
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:export");
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    await api.downloadExport();

    expect(fetchMock).toHaveBeenCalledWith("/api/export", {
      credentials: "include",
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({
      size: 14,
      type: "application/json",
    });
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toMatchObject({
      download: "clement-export.json",
      href: "blob:export",
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    click.mockRestore();
  });
});
