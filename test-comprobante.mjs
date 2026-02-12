import puppeteer from 'puppeteer';
import fs from 'fs';

// Data from the contable's example
const comprobante = {
  numero: '20260200000270',
  fechaEmision: '2026-02-10',
  periodoFiscal: '2026-02',
};

const empresa = {
  nombre: 'EL REY DE LOS PESCADOS Y MARISCOS RPYM, F.P',
  rif: 'E816000567',
  direccion: 'CALLE LOS MOLINOS ENTRADA PRINCIPAL LOCAL PESQUERO NRO 3 Y 4 URB. MAIQUETIA',
};

const proveedor = {
  nombre: 'JOSE ANTONIO DE ABREU DE GOUVEIA',
  rif: 'V171460910',
  direccion: 'AV PROLONGACION EL CORTIJO, QTA. MARIA NRO.S/N URB. LOS ROSALES , CARACAS DISTRITO CAPITAL ZONA POSTAL 1040',
};

const factura = {
  numero: '000490',
  numeroControl: '00-000490',
  fecha: '2026-02-10',
  subtotalGravable: 14332.12,
  iva: 2293.13,
  total: 16625.25,
};

const retencion = {
  porcentaje: 100,
  monto: 2293.13,
};

const [periodoYear, periodoMonth] = comprobante.periodoFiscal.split('-');
const formatNum = (n) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDateDMY = (dateStr) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

const alicuota = factura.subtotalGravable > 0
  ? Math.round((factura.iva / factura.subtotalGravable) * 100)
  : 16;
const impuestoCausado = factura.iva;
const impuestoRetenido = retencion.monto;

const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Comprobante de Retención IVA - ${comprobante.numero}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }

    body {
      font-family: Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.3;
      color: #000;
      background: #fff;
    }

    /* LANDSCAPE format */
    @page { size: letter landscape; margin: 10mm 12mm 10mm 12mm; }

    .wrap {
      width: 100%;
      margin: 0 auto;
    }

    .header {
      position: relative;
      text-align: center;
      margin: 0 0 4mm;
    }
    .page-num {
      position: absolute;
      right: 0;
      top: 0;
      font-size: 9pt;
    }
    .company-name {
      font-size: 14pt;
      font-weight: 700;
    }
    .company-rif {
      font-size: 10pt;
      font-weight: 700;
      margin-top: 1mm;
    }

    .doc-title {
      text-align: center;
      font-size: 10pt;
      font-weight: 700;
      text-decoration: underline;
      margin: 2mm 0 2mm;
    }

    .legal {
      font-size: 7.5pt;
      line-height: 1.2;
      text-align: justify;
      margin: 0 0 3mm;
    }

    .meta {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .meta td {
      vertical-align: top;
      padding: 0.5mm 0;
      width: 50%;
    }
    .label { font-weight: 700; }

    .parties {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .parties > tbody > tr > td {
      vertical-align: top;
      width: 50%;
    }
    .party-title {
      text-align: center;
      font-weight: 700;
      margin: 0 0 2mm;
      font-size: 9pt;
    }
    .kv {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
    }
    .kv td {
      vertical-align: top;
      padding: 0.3mm 0;
    }
    .kv .k {
      width: 24mm;
      font-weight: 700;
      padding-right: 2mm;
    }
    .kv .v {
      word-break: break-word;
    }

    .ret-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8pt;
      margin-top: 1mm;
    }
    .ret-table thead tr.section-headers th {
      font-weight: 700;
      font-size: 9pt;
      padding: 2mm 1mm;
      border-bottom: none;
    }
    .ret-table thead th {
      font-weight: 700;
      font-size: 7pt;
      line-height: 1.15;
      padding: 1.5mm 1mm;
      text-align: center;
      vertical-align: bottom;
      border-bottom: 0.5pt solid #000;
    }
    .ret-table tbody td {
      padding: 1.5mm 1mm;
      text-align: center;
      vertical-align: top;
      font-size: 9pt;
    }
    .r { text-align: right !important; }

    .totals td { padding-top: 1.5mm; }
    .totline {
      border-top: 0.5pt solid #000;
      padding-top: 1mm !important;
    }

    .signature {
      margin-top: 10mm;
      text-align: center;
      font-size: 9pt;
    }
    .sig-line {
      border-top: 0.5pt solid #000;
      width: 70mm;
      margin: 0 auto;
      padding-top: 1mm;
    }

    .delivery {
      margin-top: 5mm;
      font-size: 9pt;
    }
    .delivery .line {
      display: inline-block;
      border-bottom: 0.5pt solid #000;
      width: 50mm;
      margin-left: 5mm;
    }

    .disclaimer {
      margin-top: 5mm;
      font-size: 8pt;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="page-num">Pág. 1</div>
      <div class="company-name">${empresa.nombre}</div>
      <div class="company-rif">R.I.F. Nº ${empresa.rif}</div>
    </div>

    <div class="doc-title">COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO</div>

    <div class="legal">
      (Ley IVA - Art. 11. Gaceta Oficial 6.152 Extraordinario: "La Administración Tributaria podrá designar como responsables del pago del impuesto, en calidad de agentes de retención, a quienes por sus funciones públicas o por razón de sus actividades privadas intervengan en operaciones gravadas con el impuesto establecido en este Decreto con Rango, Valor y Fuerza de Ley")
    </div>

    <table class="meta">
      <tr>
        <td><span class="label">Ciudad</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;MAIQUETIA</td>
        <td><span class="label">Nº Comprobante</span>&nbsp;&nbsp;&nbsp;&nbsp;${comprobante.numero}</td>
      </tr>
      <tr>
        <td><span class="label">Fecha de Emisión</span>&nbsp;&nbsp;&nbsp;&nbsp;${formatDateDMY(comprobante.fechaEmision)}</td>
        <td><span class="label">Periodo Fiscal</span>&nbsp;&nbsp;&nbsp;&nbsp;Año :&nbsp;&nbsp;&nbsp;&nbsp;${periodoYear}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/ Mes :&nbsp;&nbsp;&nbsp;&nbsp;${periodoMonth}</td>
      </tr>
    </table>

    <table class="parties">
      <tbody>
      <tr>
        <td style="padding-right: 10mm;">
          <div class="party-title">DATOS DEL AGENTE DE RETENCION</div>
          <table class="kv">
            <tr><td class="k">Nombre<br>o Razón Social</td><td class="v">${empresa.nombre}</td></tr>
            <tr><td class="k">Nº R.I.F.</td><td class="v">${empresa.rif}</td></tr>
            <tr><td class="k">Nº N.I.T.</td><td class="v"></td></tr>
            <tr><td class="k">Dirección</td><td class="v">${empresa.direccion}</td></tr>
            <tr><td class="k">Teléfonos</td><td class="v">-</td></tr>
          </table>
        </td>
        <td style="padding-left: 10mm;">
          <div class="party-title">DATOS DEL BENEFICIARIO</div>
          <table class="kv">
            <tr><td class="k">Nombre<br>o Razón Social</td><td class="v">${proveedor.nombre}</td></tr>
            <tr><td class="k">Nº R.I.F.</td><td class="v">${proveedor.rif}</td></tr>
            <tr><td class="k">Nº N.I.T.</td><td class="v"></td></tr>
            <tr><td class="k">Dirección</td><td class="v">${proveedor.direccion}</td></tr>
            <tr><td class="k">Teléfonos</td><td class="v"></td></tr>
          </table>
        </td>
      </tr>
      </tbody>
    </table>

    <table class="ret-table">
      <colgroup>
        <col style="width: 2%;">
        <col style="width: 14%;">
        <col style="width: 7%;">
        <col style="width: 17%;">
        <col style="width: 6%;">
        <col style="width: 5%;">
        <col style="width: 10%;">
        <col style="width: 7%;">
        <col style="width: 9%;">
        <col style="width: 4%;">
        <col style="width: 9%;">
        <col style="width: 10%;">
      </colgroup>
      <thead>
        <tr class="section-headers">
          <th colspan="6" style="text-align:center;font-weight:700;border-bottom:none;padding-bottom:0;">DATOS DE LA RETENCIÓN</th>
          <th colspan="6" style="text-align:center;font-weight:700;border-bottom:none;padding-bottom:0;">COMPRAS INTERNAS o<br>IMPORTACIONES</th>
        </tr>
        <tr>
          <th>Nº</th>
          <th style="white-space:nowrap;">Fecha Doc. Nº Factura</th>
          <th>Nº Control</th>
          <th style="white-space:nowrap;">Nº Nota Débito Nº Nota Crédito</th>
          <th>Tipo de<br>Transacción</th>
          <th>Nº Fact.<br>Afectada</th>
          <th>Total Factura o<br>Nota Débito</th>
          <th>Sin derecho a<br>Crédito</th>
          <th>Base Imponible</th>
          <th>%<br>Alíc.</th>
          <th>Impuesto<br>Causado</th>
          <th>Impuesto<br>Retenido</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${formatDateDMY(factura.fecha)} ${factura.numero}</td>
          <td>${factura.numeroControl}</td>
          <td></td>
          <td style="white-space:nowrap;">01 Registro</td>
          <td></td>
          <td class="r">${formatNum(factura.total)}</td>
          <td class="r">0,00</td>
          <td class="r">${formatNum(factura.subtotalGravable)}</td>
          <td class="r">${formatNum(alicuota)}</td>
          <td class="r">${formatNum(impuestoCausado)}</td>
          <td class="r">${formatNum(impuestoRetenido)}</td>
        </tr>
        <tr class="totals">
          <td colspan="6"></td>
          <td class="r totline">${formatNum(factura.total)}</td>
          <td class="r totline">0,00</td>
          <td class="r totline">${formatNum(factura.subtotalGravable)}</td>
          <td></td>
          <td class="r totline">${formatNum(impuestoCausado)}</td>
          <td class="r totline">${formatNum(impuestoRetenido)}</td>
        </tr>
      </tbody>
    </table>

    <div class="signature">
      <div class="sig-line">
        Firma Y Sello Agente De Retención<br>
        R.I.F. Nº ${empresa.rif}
      </div>
    </div>

    <div class="delivery">
      <span class="label">Fecha de Entrega</span><span class="line"></span>
    </div>

    <div class="disclaimer">
      Este comprobante se emite en función a lo establecido en el artículo 16 de la Providencia Administrativa Nº SNAT/2025/000054 de fecha 16/07/2025
    </div>
  </div>
</body>
</html>`;

async function main() {
  fs.writeFileSync('test-comprobante.html', html);
  console.log('HTML saved to test-comprobante.html');

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // LANDSCAPE: 11 x 8.5 inches at 96dpi = 1056 x 816
  await page.setViewport({ width: 1056, height: 816 });
  await page.setContent(html, { waitUntil: 'networkidle0' });

  await page.screenshot({
    path: 'comprobante-screenshot.png',
    fullPage: true
  });
  console.log('Screenshot saved to comprobante-screenshot.png');

  await page.pdf({
    path: 'comprobante-test.pdf',
    format: 'letter',
    landscape: true,
    margin: { top: '12mm', right: '15mm', bottom: '12mm', left: '15mm' },
    printBackground: true,
  });
  console.log('PDF saved to comprobante-test.pdf');

  await browser.close();
}

main().catch(console.error);
