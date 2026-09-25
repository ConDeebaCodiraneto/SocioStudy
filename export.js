/* ============================================================
   export.js — one-click ZIP archive of the whole study
   (button on the Analysis page). Bundles:
     - README.txt (contents guide, localized)
     - config.json / responses.json (answers)
     - votes.csv / matrix.csv / summary.csv
     - class charts as PNG (linear, step, distribution)
     - sociogram as SVG + PNG
   Everything is generated in the browser: charts are rendered on
   detached canvases (fixed light theme, white background) and the
   sociogram is built headlessly with a synchronous D3 simulation,
   so the export works from any page and in dark mode.
   With "Hide names in exports" on, children appear as codes
   (Student 01, 02 … in roster order).
   ============================================================ */

const Exporter = {

  /** Config + analysis for exports: every question, names hidden when requested. */
  dataset() {
    const c = Store.exportAnon ? Analysis.anonymize(Store.config) : Store.config;
    return { c, a: Analysis.compute(c, Store.responses) };
  },

  async exportZIP() {
    if (typeof JSZip === 'undefined') { toast(t('exp.libFail')); return; }
    if (!Store.config.roster.length) { toast(t('an.empty')); return; }
    toast(t('exp.working'), 60000);

    // Let the toast paint before the synchronous work.
    await new Promise(r => setTimeout(r, 30));

    try {
      const { c, a } = this.dataset();
      const zip = new JSZip();
      const dir = zip.folder('sociostudy');

      dir.file('README.txt', this.readme(c, a));
      dir.file('config.json', JSON.stringify(c, null, 2));
      dir.file('responses.json', JSON.stringify(Store.responses, null, 2));

      const BOM = '\uFEFF';
      dir.file('votes.csv', BOM + Tables.votesCSV(a, c));
      dir.file('matrix.csv', BOM + Tables.matrixCSV(a, c));
      dir.file('summary.csv', BOM + Tables.summaryCSV(a, c));

      /* ---------- charts (class level only) ---------- */
      const chartsDir = dir.folder('charts');
      this.addB64(chartsDir, 'linear.png', Charts.chartPNG('linear', a, { W: 1100, H: 560 }));
      this.addB64(chartsDir, 'step.png', Charts.chartPNG('step', a, { W: 1100, H: 560 }));
      this.addB64(chartsDir, 'distribution.png', Charts.chartPNG('dist', a, { W: 1100, H: 560 }));

      /* ---------- sociogram ---------- */
      const socio = Sociogram.exportSVG(a);
      dir.file('sociogram.svg', socio.text);
      const socioPNG = await this.svgToPNG(socio.text, 1100, 700, 2);
      if (socioPNG) dir.file('sociogram.png', socioPNG, { base64: true });

      /* ---------- generate + download ---------- */
      const files = Object.keys(zip.files).filter(n => !zip.files[n].dir).length;
      const blob = await zip.generateAsync({ type: 'blob' });
      Tables.download('sociostudy-export.zip', blob, 'application/zip');
      toast(tp('exp.done', files));
    } catch (e) {
      console.error(e);
      toast(t('exp.fail'));
    }
  },

  addB64(dir, name, b64) { if (b64) dir.file(name, b64, { base64: true }); },

  /** Rasterize an SVG string to PNG base64 (white background). */
  svgToPNG(svgText, w, h, scale) {
    return new Promise(resolve => {
      try {
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = w * (scale || 1);
            canvas.height = h * (scale || 1);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png').split(',')[1]);
          } catch (e) { URL.revokeObjectURL(url); resolve(null); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  },

  readme(c, a) {
    const lines = [
      t('app.title'),
      '================================',
      '',
      tp('exp.rmClass', c.className || '—', c.grade || '—', c.schoolYear || '—'),
      tp('exp.rmGenerated', new Date().toLocaleString(I18N.lang === 'bg' ? 'bg-BG' : 'en-US')),
      tp('exp.rmStudents', c.roster.length, a.respondents.size),
      ...(Store.exportAnon ? ['', t('exp.rmAnon')] : []),
      '',
      t('exp.rmContents') + ':',
      '  - config.json — ' + t('exp.rmConfig'),
      '  - responses.json — ' + t('exp.rmResponses'),
      '  - votes.csv — ' + t('exp.rmVotes'),
      '  - matrix.csv — ' + t('exp.rmMatrix'),
      '  - summary.csv — ' + t('exp.rmSummary'),
      '  - charts/ — ' + t('exp.rmCharts'),
      '  - sociogram.svg / sociogram.png — ' + t('exp.rmSocio'),
      '',
      t('exp.rmStatuses') + ':',
      ...STATUS_ORDER.map(s => '  ' + statusLabel(s) + ' — ' + t(STATUS_META[s].descKey)),
      '',
      t('an.disclaimer'),
    ];
    return lines.join('\n');
  },
};
