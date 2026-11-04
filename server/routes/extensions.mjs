import fs from "node:fs";
import path from "node:path";
import {DATA} from "../config.mjs";
import {all,get,put} from "../store.mjs";
import {secretGet} from "../vault.mjs";
import {resolveModel} from "../model-router.mjs";
import {mcpServers,saveMcp,deleteMcp,discoverMcp} from "../mcp.mjs";
import {mcpPresets} from "../mcp-presets.mjs";
import {skillCatalog,skillCatalogMeta,importCatalogSkill,importSkillsFromRepo} from "../skill-catalog.mjs";

export async function handleExtensionRoutes({url,method,res,json,body,u,req}){
  if (url === "/api/translate/config" && method === "GET")
    return json(
      res,
      get("translate_config", "default") || { providerId: "", model: "" },
    );
  if (url === "/api/translate/config" && method === "POST") {
    const input = await body(req);
    return json(
      res,
      put("translate_config", {
        id: "default",
        providerId: String(input.providerId || ""),
        model: String(input.model || ""),
      }),
    );
  }
  if (url === "/api/translate" && method === "POST") {
    const input = await body(req);
    const text = String(input.text || "").slice(0, 2000);
    if (!text) return json(res, { text: "" });
    try {
      return json(res, { text: await googleTranslate(text) });
    } catch {}
    try {
      const saved = get("translate_config", "default") || {};
      const route =
        saved.providerId && saved.model
          ? { providerId: saved.providerId, model: saved.model }
          : await resolveModel({});
      const provider = all("provider").find((p) => p.id === route.providerId);
      const response = await fetch(
        provider.baseUrl.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secretGet("provider:" + provider.id)
              ? {
                  Authorization:
                    "Bearer " + secretGet("provider:" + provider.id),
                }
              : {}),
          },
          body: JSON.stringify({
            model: route.model,
            messages: [
              {
                role: "user",
                content:
                  "다음 영어 문장을 자연스러운 한국어 한 문장으로 번역해라. 번역문만 출력: " +
                  text,
              },
            ],
            max_tokens: 300,
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      const data = await response.json();
      return json(res, {
        text: String(data.choices?.[0]?.message?.content || "").trim(),
      });
    } catch (error) {
      return json(res, { text: "", error: String(error?.message || error) });
    }
  }
  if (url === "/api/mcp/catalog" && method === "GET") {
    const q = (u.searchParams.get("q") || "").trim();
    const endpoint = new URL(
      "https://registry.modelcontextprotocol.io/v0.1/servers",
    );
    if (q.length >= 3) endpoint.searchParams.set("search", q);
    endpoint.searchParams.set("version", "latest");
    endpoint.searchParams.set("limit", "60");
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error("MCP registry HTTP " + response.status);
    const raw = await response.json();
    const seen = new Set();
    return json(
      res,
      (raw.servers || [])
        .map((x) => {
          const s = x.server || x;
          const pkg = (s.packages || []).find(
            (p) => (p.registryType || p.registry_type) === "npm",
          );
          const remote = (s.remotes || []).find((r) =>
            /^https:\/\//.test(r.url || ""),
          );
          return {
            name: s.name,
            description: s.description || "",
            packageName: pkg?.identifier || "",
            url: remote?.url || "",
          };
        })
        .filter((x) => {
          if (!x.name || seen.has(x.name)) return false;
          seen.add(x.name);
          return true;
        }),
    );
  }
  if (url === "/api/mcp") {
    if (method === "GET") return json(res, mcpServers());
    if (method === "POST") return json(res, saveMcp(await body(req)));
  }
  if (url === "/api/mcp/presets" && method === "GET")
    return json(res, mcpPresets());
  if (url === "/api/mcp/discover" && method === "GET")
    return json(res, await discoverMcp());
  if (url === "/api/tools" && method === "GET")
    return json(res, await toolsForModel());
  if (url === "/api/model-route" && method === "GET")
    return json(res, await resolveModel());
  if (url === "/api/commands" && method === "GET")
    return json(res, commandDefinitions);
  if (url === "/api/experience/strategies" && method === "GET") {
    return json(res, {
      strategies: strategyStats(),
      guidance: strategyGuidance(),
    });
  }
  if (url === "/api/approvals" && method === "GET")
    return json(res, approvals());
  if (url === "/api/approvals" && method === "POST") {
    const x = await body(req);
    return json(res, { ok: resolveApproval(x.id, x.allow) });
  }
  if (url === "/api/skills") {
    if (method === "GET") return json(res, all("skill"));
    if (method === "POST") {
      const x = await body(req);
      return json(
        res,
        put("skill", {
          ...x,
          id: x.id || crypto.randomUUID(),
          name: String(x.name || "Skill"),
          enabled: Boolean(x.enabled),
        }),
      );
    }
  }

  if (url.match(/^\/api\/skills\/[^/]+\/export$/) && method === "GET") {
    const id = url.split("/")[3];
    const skill = get("skill", id);
    if (!skill) throw Error("스킬을 찾을 수 없습니다");
    const body =
      "---\nname: " +
      skill.name +
      "\n---\n\n" +
      String(skill.instructions || "");
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="' +
        String(skill.name).replace(/[^\w.-]+/g, "-") +
        '.md"',
    });
    res.end(body);
    return;
  }
  if (url.match(/^\/api\/skills\/[^/]+\/translate$/) && method === "POST") {
    const id = url.split("/")[3];
    const skill = get("skill", id);
    if (!skill) throw Error("스킬을 찾을 수 없습니다");
    const source = String(skill.instructions || "");
    const savedCfg = get("translate_config", "default") || {};
    const route =
      savedCfg.providerId && savedCfg.model
        ? { providerId: savedCfg.providerId, model: savedCfg.model }
        : await resolveModel({});
    const provider = all("provider").find((p) => p.id === route.providerId);
    const key = secretGet("provider:" + provider.id);
    const call = async (text) => {
      try {
        const fast = await googleTranslate(text);
        if (fast) return fast;
      } catch {}
      const response = await fetch(
        provider.baseUrl.replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { Authorization: "Bearer " + key } : {}),
          },
          body: JSON.stringify({
            model: route.model,
            messages: [
              {
                role: "system",
                content:
                  "You translate developer documentation into natural Korean. Keep Markdown structure, headings, lists and tables. Never translate code blocks, inline code, file paths, commands, URLs or identifiers. Output only the translation.",
              },
              { role: "user", content: text },
            ],
            max_tokens: 3000,
          }),
          signal: AbortSignal.timeout(90000),
        },
      );
      const data = await response.json();
      const out = String(data.choices?.[0]?.message?.content || "").trim();
      if (!out) throw Error("빈 번역");
      return out;
    };
    // Keep fenced code blocks untouched.
    const segments = source.split(/(```[\s\S]*?```)/g);
    const result = [];
    for (const segment of segments) {
      if (!segment) continue;
      if (segment.startsWith("```")) {
        result.push(segment);
        continue;
      }
      const chunks = [];
      for (let i = 0; i < segment.length; i += 1500)
        chunks.push(segment.slice(i, i + 1500));
      const translated = [];
      for (let i = 0; i < chunks.length; i += 3) {
        const batch = chunks.slice(i, i + 3);
        translated.push(
          ...(await Promise.all(
            batch.map((chunk) => call(chunk).catch(() => chunk)),
          )),
        );
      }
      result.push(translated.join(""));
    }
    const instructionsKo = result.join("").slice(0, 40000);
    put("skill", { ...skill, instructionsKo });
    return json(res, { id, instructionsKo });
  }
  if (url === "/api/skills/import-repo" && method === "POST") {
    const body_ = await body(req);
    return json(
      res,
      await importSkillsFromRepo(body_.repo, { limit: body_.limit || 60 }),
    );
  }
  if (url === "/api/skill-catalog" && method === "GET")
    return json(
      res,
      skillCatalog({
        q: u.searchParams.get("q") || "",
        category: u.searchParams.get("category") || "",
        source: u.searchParams.get("source") || "",
        limit: u.searchParams.get("limit") || 500,
      }),
    );
  if (url === "/api/skill-catalog/meta" && method === "GET")
    return json(res, skillCatalogMeta());
  if (url === "/api/skill-catalog/import" && method === "POST")
    return json(res, await importCatalogSkill((await body(req)).id));
  if (url === "/api/memory/overview" && method === "GET") {
    const rows = all("memory");
    const byType = {};
    const bySource = {};
    for (const row of rows) {
      byType[row.type || "미분류"] = (byType[row.type || "미분류"] || 0) + 1;
      bySource[row.source || "manual"] =
        (bySource[row.source || "manual"] || 0) + 1;
    }
    return json(res, {
      path: path.join(DATA, "dominion.sqlite"),
      table: "records (kind=memory)",
      total: rows.length,
      byType,
      bySource,
      status: rows.reduce((a, r) => {
        const k = r.status || "active";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {}),
    });
  }
  if (url === "/api/upload" && method === "POST") {
    const name = String(u.searchParams.get("name") || "upload.bin").replace(/[^\w.-]+/g, "_");
    const dir = path.join(DATA, "uploads");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, Date.now() + "-" + name);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(target);
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      req.on("error", reject);
    });
    return json(res, { path: target, name });
  }
  return false;
}
