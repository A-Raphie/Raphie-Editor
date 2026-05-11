#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import { createConfig, MODELS } from "./config.js";
import { Pipeline } from "./pipeline/orchestrator.js";

function printUsage(): void {
  console.log(`
Raphie's Editor — Autonomous Documentary Pipeline

Usage:
  npx tsx src/index.ts <command> [options]

Commands:
  run <script.txt> <vo.mp3> [music.mp3]   Run full pipeline
  resume                                   Resume failed/interrupted pipeline
  models                                   List available model options

Options (for "run" command):
  --model <default|budget>                Model tier (default: default)
  --scene-model <model_id>                Override scene planner model
  --quality-model <model_id>              Override quality checker model

Examples:
  npx tsx src/index.ts run input/script.txt input/vo.mp3
  npx tsx src/index.ts run input/script.txt input/vo.mp3 assets/music/bg.mp3 --model budget
  npx tsx src/index.ts resume
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  if (command === "models") {
    console.log("Available model options:\n");
    for (const [key, models] of Object.entries(MODELS)) {
      console.log(`  ${key}:`);
      console.log(`    Scene Planner:  ${models.scenePlanner}`);
      console.log(`    Quality Checker: ${models.qualityChecker}`);
      console.log();
    }
    return;
  }

  if (command === "resume") {
    const config = createConfig();
    const pipeline = new Pipeline(config);
    const outputPath = await pipeline.resume();
    console.log(`\nResumed pipeline complete! Output: ${outputPath}`);
    return;
  }

  if (command === "run") {
    const scriptPath = args[1];
    const voPath = args[2];
    const musicPath = args[3]?.startsWith("--") ? undefined : args[3];

    if (!scriptPath || !voPath) {
      console.error("Error: script and VO file paths required");
      printUsage();
      process.exit(1);
    }

    const modelOption = (args.find((a, i) => args[i - 1] === "--model") ?? "default") as "default" | "budget";
    const sceneModel = args.find((a, i) => args[i - 1] === "--scene-model");
    const qualityModel = args.find((a, i) => args[i - 1] === "--quality-model");

    const config = createConfig({
      modelOption,
      ...(sceneModel ? { scenePlannerModel: sceneModel } : {}),
      ...(qualityModel ? { qualityCheckerModel: qualityModel } : {}),
    });

    console.log(`\nRaphie's Editor`);
    console.log(`Scene Planner:  ${config.scenePlannerModel}`);
    console.log(`Quality Checker: ${config.qualityCheckerModel}`);
    console.log(`Concurrency: ${config.concurrency}`);
    console.log(`Output: 1920x1080 @ ${config.fps}fps`);
    console.log();

    const pipeline = new Pipeline(config);
    const outputPath = await pipeline.run(
      path.resolve(scriptPath),
      path.resolve(voPath),
      musicPath ? path.resolve(musicPath) : undefined
    );

    console.log(`\nDone! Video saved to: ${outputPath}`);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
