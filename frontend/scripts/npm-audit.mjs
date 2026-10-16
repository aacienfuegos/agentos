// Auditoría npm del CI con excepciones por advisory y con fecha de caducidad.
//
// Hace lo mismo que `npm audit --audit-level=moderate`, pero deja pasar los
// advisories de EXCEPCIONES hasta su fecha `hasta`. Pasada esa fecha, la
// excepción deja de valer y el CI falla: hay que revisar si ya hay parche y
// quitarla, o renovarla con una fecha nueva.
//
// Uso: `npm run audit:ci` desde frontend/. Solo usa módulos de Node, así que
// no necesita node_modules.

import { spawnSync } from "node:child_process";

const NIVELES = ["info", "low", "moderate", "high", "critical"];
const NIVEL_MINIMO = "moderate";

const EXCEPCIONES = [
  {
    // braces <= 3.0.3: denegación de servicio por patrones muy anidados. No hay
    // versión parcheada (3.0.3 es la última publicada). Llega por fast-glob ->
    // micromatch desde shadcn y eslint-config-next, que solo lo usan en
    // desarrollo y build con patrones del propio repo, no con entrada de usuario.
    advisory: "GHSA-vfj7-8cjw-p6xm",
    paquete: "braces",
    hasta: "2026-11-16",
  },
];

const salida = spawnSync("npm", ["audit", "--json"], { encoding: "utf8" });
if (salida.error) {
  console.error(`No se pudo ejecutar npm audit: ${salida.error.message}`);
  process.exit(1);
}

let informe;
try {
  informe = JSON.parse(salida.stdout);
} catch {
  console.error("npm audit no devolvió JSON:");
  console.error(salida.stdout || salida.stderr);
  process.exit(1);
}
if (informe.error || !informe.vulnerabilities) {
  console.error("npm audit falló:");
  console.error(JSON.stringify(informe.error ?? informe, null, 2));
  process.exit(1);
}

// En `via`, los objetos son los advisories y las cadenas solo dicen por qué
// paquete llega la vulnerabilidad. Se cuentan los advisories, una vez cada uno.
const advisories = new Map();
for (const vulnerabilidad of Object.values(informe.vulnerabilities)) {
  for (const via of vulnerabilidad.via) {
    if (typeof via === "object") advisories.set(via.url, via);
  }
}

const hoy = new Date().toISOString().slice(0, 10);
const umbral = NIVELES.indexOf(NIVEL_MINIMO);
const bloqueantes = [];
const exceptuados = [];

for (const advisory of advisories.values()) {
  if (NIVELES.indexOf(advisory.severity) < umbral) continue;
  const excepcion = EXCEPCIONES.find(
    (e) => advisory.url.endsWith(`/${e.advisory}`) && advisory.name === e.paquete,
  );
  if (excepcion && hoy <= excepcion.hasta) {
    exceptuados.push({ advisory, excepcion });
  } else {
    bloqueantes.push({ advisory, caducada: excepcion?.hasta });
  }
}

const linea = (a) => `${a.severity.padEnd(8)} ${a.name} ${a.range}: ${a.title} (${a.url})`;

for (const { advisory, excepcion } of exceptuados) {
  console.log(`Exceptuado hasta ${excepcion.hasta}: ${linea(advisory)}`);
}
for (const excepcion of EXCEPCIONES) {
  const sigue = exceptuados.some((e) => e.excepcion === excepcion);
  const caducada = bloqueantes.some((b) => b.advisory.url.endsWith(`/${excepcion.advisory}`));
  if (!sigue && !caducada) {
    console.log(`La excepción de ${excepcion.advisory} ya no hace falta: quítala de este fichero.`);
  }
}

if (bloqueantes.length > 0) {
  console.error(`\nAdvisories de nivel ${NIVEL_MINIMO} o más sin excepción (${bloqueantes.length}):`);
  for (const { advisory, caducada } of bloqueantes) {
    const nota = caducada ? ` [excepción caducada el ${caducada}]` : "";
    console.error(`  ${linea(advisory)}${nota}`);
  }
  console.error("\nDetalle: npm audit");
  process.exit(1);
}

console.log(`Sin advisories de nivel ${NIVEL_MINIMO} o más fuera de las excepciones.`);
