/* BordaLink · trabajador del motor de ponchado (no congela la pantalla) */
importScripts('motor.js');
let analisis = null;
self.onmessage = (e) => {
  const { tipo } = e.data;
  try {
    if (tipo === 'analizar') {
      const { img, ancho, bordarFondo } = e.data;
      analisis = BordaLinkMotor.analizar(img, ancho, { bordarFondo });
      self.postMessage({ tipo: 'capas', capas: analisis.capas, W: analisis.W, H: analisis.H });
    } else if (tipo === 'ponchar') {
      if (!analisis) throw new Error('Primero sube una imagen');
      const ajustes = e.data.capas; analisis.capas.forEach(c => { const a = ajustes.find(x => x.id === c.id); if (a) Object.assign(c, a); });
      const plan = BordaLinkMotor.ponchar(analisis, (m) => self.postMessage({ tipo: 'progreso', msg: m }));
      const dst = BordaLinkMotor.dstBytes(plan, e.data.nombre || 'BORDALINK');
      const rev = BordaLinkMotor.revisar(plan, e.data.agujas || 9);
      rev.cortes = dst.cortes;
      const simple = plan.map(L => ({ hex: L.capa.hex, nombre: L.capa.nombre, runs: L.runs }));
      self.postMessage({ tipo: 'listo', plan: simple, dst: dst.bytes, rev, W: analisis.W, H: analisis.H }, [dst.bytes.buffer]);
    }
  } catch (err) { self.postMessage({ tipo: 'error', msg: err.message || String(err) }); }
};
