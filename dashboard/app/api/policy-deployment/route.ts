import { readFile } from "node:fs/promises";
import path from "node:path";
export const dynamic = "force-dynamic";
// Local operator preparation only. No signing key is read and no RPC mutation is exposed.
export async function GET() {
  try {
    const raw = await readFile(
      path.resolve(process.cwd(), "../.tools/cre-public-deployment.json"),
      "utf8",
    );
    const prepared = JSON.parse(raw);
    if (prepared.network !== "sepolia" || prepared.chain_id !== "11155111")
      throw new Error("unsupported");
    return Response.json(prepared, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error: {
          message:
            "Prepare the unsigned Sepolia deployment in this workspace first.",
        },
      },
      { status: 404 },
    );
  }
}
