import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const buildConfig = require("../app.config.js");
const app = require("../app.json").expo;
const eas = require("../eas.json");

test("build de teste usa Android ID separado e nao altera projeto principal", () => {
  const old = process.env.APP_VARIANT;
  try {
    delete process.env.APP_VARIANT;
    const normal = buildConfig({ config: app });
    assert.equal(normal.android.package, "com.rafah_as9.Mototrack");
    assert.equal(normal.name, "Mototrack");

    process.env.APP_VARIANT = "testing";
    const testing = buildConfig({ config: app });
    assert.equal(testing.android.package, "com.rafah_as9.mototrack.test");
    assert.notEqual(testing.android.package, normal.android.package);
    assert.notEqual(testing.scheme, normal.scheme);
    assert.notEqual(testing.name, normal.name);
    assert.equal(testing.extra.eas.projectId, normal.extra.eas.projectId);
    assert.equal(testing.plugins, normal.plugins);
  } finally {
    if (old === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = old;
  }
});

test("perfil preview-test produz APK interno e fornece variante ao EAS", () => {
  const profile = eas.build["preview-test"];
  assert.equal(profile.distribution, "internal");
  assert.equal(profile.android.buildType, "apk");
  assert.equal(profile.env.APP_VARIANT, "testing");
  assert.equal(eas.build.preview.distribution, "internal");
});
