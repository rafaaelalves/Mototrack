/**
 * Variantes do Mototrack.
 *
 * APP_VARIANT=testing usa outro ID Android, para testar importação de CSV
 * sem instalar uma atualização sobre o banco SQLite do aplicativo pessoal.
 *
 * Sem APP_VARIANT, preserva integralmente o app.json atual.
 */
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== "testing") return config;

  return {
    ...config,
    name: "Mototrack (Teste)",
    scheme: "mototrack-test",
    android: {
      ...config.android,
      package: "com.rafah_as9.mototrack.test",
    },
  };
};
