/**
 * RPYM - Sistema de Gestión de Presupuestos
 * Google Apps Script para backend
 *
 * INSTRUCCIONES:
 * 1. Ir a https://script.google.com/
 * 2. Crear nuevo proyecto
 * 3. Pegar este código
 * 4. Configurar SHEET_ID con el ID de tu Google Sheet
 * 5. Deploy > New deployment > Web app
 * 6. Ejecutar como: Tu cuenta
 * 7. Acceso: Cualquier persona
 * 8. Copiar la URL generada
 */

// ============================================
// CONFIGURACIÓN - EDITAR AQUÍ
// ============================================
const SHEET_ID = 'TU_SHEET_ID_AQUI'; // <-- Reemplazar con el ID de tu Google Sheet
const SHEET_NAME = 'Presupuestos';

// ============================================
// FUNCIONES PRINCIPALES
// ============================================

/**
 * Maneja peticiones GET
 * Soporta: listar todos, obtener por ID, estadísticas
 */
function doGet(e) {
  const params = e.parameter;
  const action = params.action || 'list';

  try {
    let result;

    switch (action) {
      case 'list':
        result = listPresupuestos(params.status);
        break;
      case 'get':
        result = getPresupuesto(params.id);
        break;
      case 'stats':
        result = getStats();
        break;
      default:
        result = { error: 'Acción no válida' };
    }

    return createJsonResponse(result);
  } catch (error) {
    return createJsonResponse({ error: error.message });
  }
}

/**
 * Maneja peticiones POST
 * Soporta: crear, actualizar estado, eliminar
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'create';

    let result;

    switch (action) {
      case 'create':
        result = createPresupuesto(data);
        break;
      case 'updateStatus':
        result = updateStatus(data.id, data.status);
        break;
      case 'delete':
        result = deletePresupuesto(data.id);
        break;
      default:
        result = { error: 'Acción no válida' };
    }

    return createJsonResponse(result);
  } catch (error) {
    return createJsonResponse({ error: error.message });
  }
}

// ============================================
// OPERACIONES CRUD
// ============================================

/**
 * Crea un nuevo presupuesto
 */
function createPresupuesto(data) {
  const sheet = getSheet();

  // Generar ID único: RPYM-AAMMDD-XXX
  const id = generateId();
  const now = new Date();

  // Preparar fila
  const row = [
    id,                                    // A: ID
    now.toISOString(),                     // B: Fecha/hora
    JSON.stringify(data.items || []),      // C: Items (JSON)
    data.totalUSD || 0,                    // D: Total USD
    data.totalBs || 0,                     // E: Total Bs
    'pendiente',                           // F: Estado
    data.clientIP || '',                   // G: IP del cliente
    '',                                    // H: Fecha de pago
    data.customerName || '',               // I: Nombre cliente
    data.customerAddress || ''             // J: Dirección
  ];

  sheet.appendRow(row);

  return {
    success: true,
    id: id,
    message: 'Presupuesto guardado correctamente'
  };
}

/**
 * Lista todos los presupuestos, opcionalmente filtrados por estado
 */
function listPresupuestos(statusFilter) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Si no hay datos o solo headers
  if (data.length <= 1) {
    return { presupuestos: [], total: 0 };
  }

  // Convertir filas a objetos (saltar header)
  let presupuestos = data.slice(1).map(row => ({
    id: row[0],
    fecha: row[1],
    items: safeJsonParse(row[2], []),
    totalUSD: row[3],
    totalBs: row[4],
    estado: row[5],
    clientIP: row[6],
    fechaPago: row[7],
    customerName: row[8] || '',
    customerAddress: row[9] || ''
  }));

  // Filtrar por estado si se especifica
  if (statusFilter && statusFilter !== 'all') {
    presupuestos = presupuestos.filter(p => p.estado === statusFilter);
  }

  // Ordenar por fecha descendente (más recientes primero)
  presupuestos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return {
    presupuestos: presupuestos,
    total: presupuestos.length
  };
}

/**
 * Obtiene un presupuesto por ID
 */
function getPresupuesto(id) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Buscar por ID (columna A)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      return {
        success: true,
        presupuesto: {
          id: data[i][0],
          fecha: data[i][1],
          items: safeJsonParse(data[i][2], []),
          totalUSD: data[i][3],
          totalBs: data[i][4],
          estado: data[i][5],
          clientIP: data[i][6],
          fechaPago: data[i][7],
          customerName: data[i][8] || '',
          customerAddress: data[i][9] || ''
        }
      };
    }
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

/**
 * Actualiza el estado de un presupuesto
 */
function updateStatus(id, newStatus) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Buscar por ID
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      // Actualizar estado (columna F = 6)
      sheet.getRange(i + 1, 6).setValue(newStatus);

      // Si es "pagado", registrar fecha de pago (columna H = 8)
      if (newStatus === 'pagado') {
        sheet.getRange(i + 1, 8).setValue(new Date().toISOString());
      }

      return { success: true, message: 'Estado actualizado' };
    }
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

/**
 * Elimina un presupuesto
 */
function deletePresupuesto(id) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  // Buscar por ID
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { success: true, message: 'Presupuesto eliminado' };
    }
  }

  return { success: false, error: 'Presupuesto no encontrado' };
}

/**
 * Obtiene estadísticas
 */
function getStats() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return {
      totalHoy: 0,
      vendidoHoyUSD: 0,
      vendidoHoyBs: 0,
      pendientes: 0,
      totalGeneral: 0
    };
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let totalHoy = 0;
  let vendidoHoyUSD = 0;
  let vendidoHoyBs = 0;
  let pendientes = 0;

  for (let i = 1; i < data.length; i++) {
    const fecha = new Date(data[i][1]);
    const estado = data[i][5];
    const totalUSD = parseFloat(data[i][3]) || 0;
    const totalBs = parseFloat(data[i][4]) || 0;

    // Verificar si es de hoy
    fecha.setHours(0, 0, 0, 0);
    if (fecha.getTime() === hoy.getTime()) {
      totalHoy++;
      if (estado === 'pagado') {
        vendidoHoyUSD += totalUSD;
        vendidoHoyBs += totalBs;
      }
    }

    if (estado === 'pendiente') {
      pendientes++;
    }
  }

  return {
    totalHoy: totalHoy,
    vendidoHoyUSD: vendidoHoyUSD.toFixed(2),
    vendidoHoyBs: vendidoHoyBs.toFixed(2),
    pendientes: pendientes,
    totalGeneral: data.length - 1
  };
}

// ============================================
// UTILIDADES
// ============================================

/**
 * Obtiene o crea la hoja de presupuestos
 */
function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  // Si no existe, crearla con headers
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'ID',
      'Fecha',
      'Items',
      'Total USD',
      'Total Bs',
      'Estado',
      'IP Cliente',
      'Fecha Pago',
      'Nombre Cliente',
      'Dirección'
    ]);

    // Formatear headers
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Genera un ID único
 * Formato: RPYM-AAMMDD-XXX (XXX = contador de 3 dígitos)
 */
function generateId() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const datePrefix = `RPYM-${year}${month}${day}`;

  // Contar presupuestos de hoy para el número secuencial
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].startsWith(datePrefix)) {
      count++;
    }
  }

  const sequence = String(count + 1).padStart(3, '0');
  return `${datePrefix}-${sequence}`;
}

/**
 * Parsea JSON de forma segura
 */
function safeJsonParse(str, defaultValue) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Crea respuesta JSON con CORS habilitado
 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// FUNCIÓN DE PRUEBA
// ============================================

/**
 * Función para probar localmente
 * Ejecutar desde el editor de Apps Script
 */
function testCreate() {
  const testData = {
    action: 'create',
    items: [
      { nombre: 'Camarón 41/50', cantidad: 2, precio: 15.00 },
      { nombre: 'Jaiba', cantidad: 1, precio: 12.00 }
    ],
    totalUSD: 42.00,
    totalBs: 1680.00,
    customerName: 'Test Cliente',
    customerAddress: 'Calle Test 123'
  };

  const result = createPresupuesto(testData);
  Logger.log(result);
}

function testList() {
  const result = listPresupuestos();
  Logger.log(result);
}

function testStats() {
  const result = getStats();
  Logger.log(result);
}
