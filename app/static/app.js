const PAGE_SIZE = 20;
const MOVEMENT_PAGE_SIZE = 50;
const catalogState = { offset: 0, total: 0, loaded: false, includeInactive: false };
const movementState = { offset: 0, total: 0, loaded: false };
const receiptState = { loaded: false };
const excelReceiptState = { batchRef: null, preview: null };
const saleState = { offset: 0, total: 0, loaded: false, optionsLoaded: false, selection: new Map(), productCache: new Map(), items: [] };
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 });
const weightFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 4 });

const byId = (id) => document.getElementById(id);
const makeCell = (value, className = "") => {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = value == null || value === "" ? "—" : String(value);
  return cell;
};

function showTableMessage(body, colspan, message, isError = false) {
  const row = document.createElement("tr");
  const cell = makeCell(message, `table-message${isError ? " error" : ""}`);
  cell.colSpan = colspan;
  row.append(cell);
  body.replaceChildren(row);
}

function setApiStatus(online) {
  const status = byId("api-status");
  status.classList.toggle("offline", !online);
  status.querySelector("span:last-child").textContent = online ? "API conectada" : "API sin conexión";
}

function updatePager(kind, total, offset, pageSize) {
  const page = kind === "catalog" ? "catalog" : "movement";
  const label = byId(`${page}-page-label`);
  const previous = byId(`${page}-prev`);
  const next = byId(`${page}-next`);
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + pageSize, total);
  label.textContent = total === 0 ? "Sin resultados" : `Mostrando ${start}–${end} de ${total}`;
  previous.disabled = offset <= 0;
  next.disabled = offset + pageSize >= total;
}

function renderCatalog(items) {
  const body = byId("catalog-rows");
  if (!items.length) {
    showTableMessage(body, 9, "No encontramos productos con esos filtros.");
    return;
  }
  const rows = items.map((product) => {
    const row = document.createElement("tr");
    row.classList.toggle("product-row-inactive", !product.activo);
    row.append(
      makeCell(product.sku),
      makeCell(product.codigo_b),
      makeCell(product.nombre),
      makeCell(weightFormat.format(Number(product.peso))),
      makeCell(quantityFormat.format(Number(product.unidades_por_caja))),
      makeCell(quantityFormat.format(Number(product.disponible ?? 0)), Number(product.disponible ?? 0) < 10 ? "stock-low" : "stock-cell"),
      makeCell(money.format(Number(product.precio_vigente)), "price-cell"),
      makeCell(money.format(Number(product.precio_con_iva)), "price-cell"),
    );
    const actionCell = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "catalog-actions-cell";
    const statusAction = document.createElement("button");
    statusAction.type = "button";
    statusAction.className = "catalog-product-action " + (product.activo ? "retire" : "restore");
    statusAction.textContent = product.activo ? "Retirar" : "Reactivar";
    statusAction.setAttribute("aria-label", (product.activo ? "Retirar " : "Reactivar ") + product.nombre);
    statusAction.addEventListener("click", () => changeCatalogProductStatus(product, !product.activo));
    actionGroup.append(statusAction);
    if (!product.activo) {
      const deleteAction = document.createElement("button");
      deleteAction.type = "button";
      deleteAction.className = "catalog-product-action delete";
      deleteAction.textContent = "Eliminar";
      deleteAction.setAttribute("aria-label", "Eliminar del catálogo " + product.nombre);
      deleteAction.addEventListener("click", () => deleteCatalogProduct(product));
      actionGroup.append(deleteAction);
    }
    actionCell.append(actionGroup);
    row.append(actionCell);
    return row;
  });
  body.replaceChildren(...rows);
}

function showCatalogActionResult(success, title, message) {
  const result = byId("catalog-action-result");
  result.className = "form-result " + (success ? "success" : "error");
  result.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const detail = document.createElement("span");
  detail.textContent = message;
  result.replaceChildren(heading, detail);
}

async function changeCatalogProductStatus(product, active) {
  const action = active ? "reactivar" : "retirar";
  let confirmation = "¿Quieres " + action + " «" + product.nombre + "» del catálogo?";
  if (!active) {
    confirmation += " Dejará de aparecer para nuevas ventas y recepciones; sus movimientos y stock se conservarán.";
    const available = Number(product.disponible || 0);
    if (available > 0) confirmation += " Stock disponible actual: " + quantityFormat.format(available) + " unidades.";
  }
  if (!window.confirm(confirmation)) return;
  try {
    const response = await fetch("/catalog/products/" + encodeURIComponent(product.sku) + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: active }),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail || {};
      throw new Error(detail.message || "No se pudo cambiar el estado del artículo.");
    }
    const stockMessage = Number(data.stock_fisico || 0) > 0
      ? " El inventario físico conservado en sus lotes es " + quantityFormat.format(Number(data.stock_fisico)) + " unidades."
      : " El historial del producto se conservó.";
    showCatalogActionResult(
      true,
      active ? "Artículo reactivado" : "Artículo retirado",
      product.nombre + " ya " + (active ? "está disponible" : "no aparecerá para nuevas ventas ni recepciones") + "." + stockMessage
    );
    catalogState.offset = 0;
    await loadCatalog();
  } catch (error) {
    showCatalogActionResult(false, "No se pudo actualizar el artículo", error.message || "No se pudo conectar con la API.");
  }
}

async function deleteCatalogProduct(product) {
  let confirmation = "¿Eliminar definitivamente «" + product.nombre + "» del catálogo? Sus códigos I/B quedarán disponibles para otros productos. Sus lotes y movimientos históricos se conservarán.";
  const stock = Number(product.disponible || 0);
  if (stock > 0) confirmation += " Aún registra " + quantityFormat.format(stock) + " unidades disponibles; permanecerán en el historial y no podrán venderse desde este artículo eliminado.";
  if (!window.confirm(confirmation)) return;
  try {
    const response = await fetch("/catalog/products/" + encodeURIComponent(product.sku), { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail || {};
      throw new Error(detail.message || "No se pudo eliminar el artículo del catálogo.");
    }
    const remainingStock = Number(data.stock_fisico_conservado || 0);
    const stockMessage = remainingStock > 0
      ? " Se conservaron " + quantityFormat.format(remainingStock) + " unidades en sus lotes históricos."
      : " Se conservó el historial de lotes y movimientos.";
    showCatalogActionResult(true, "Artículo eliminado del catálogo", product.nombre + " ya no aparecerá en el catálogo. Sus códigos quedaron liberados." + stockMessage);
    catalogState.offset = 0;
    await loadCatalog();
  } catch (error) {
    showCatalogActionResult(false, "No se pudo eliminar el artículo", error.message || "No se pudo conectar con la API.");
  }
}
async function loadCatalog() {
  const body = byId("catalog-rows");
  showTableMessage(body, 9, "Cargando productos…");
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(catalogState.offset) });
  const query = byId("catalog-query").value.trim();
  if (query) params.set("q", query);
  if (catalogState.includeInactive) params.set("incluir_inactivos", "true");
  byId("catalog-inactive-toggle").textContent = catalogState.includeInactive ? "Solo activos" : "Mostrar retirados";
  byId("catalog-inactive-toggle").setAttribute("aria-pressed", String(catalogState.includeInactive));
  try {
    const response = await fetch(`/catalog/products?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`No se pudo cargar el catálogo (${response.status}).`);
    const result = await response.json();
    catalogState.total = result.total;
    catalogState.loaded = true;
    renderCatalog(result.items || []);
    byId("product-total").textContent = quantityFormat.format(result.total);
    byId("catalog-result-caption").textContent = result.total === 1 ? "1 producto coincide con los filtros" : `${quantityFormat.format(result.total)} productos coinciden con los filtros`;
    updatePager("catalog", catalogState.total, catalogState.offset, PAGE_SIZE);
    setApiStatus(true);
  } catch (error) {
    showTableMessage(body, 9, error.message || "No se pudo conectar con la API.", true);
    byId("catalog-result-caption").textContent = "No fue posible cargar el catálogo";
    byId("product-total").textContent = "—";
    updatePager("catalog", 0, 0, PAGE_SIZE);
    setApiStatus(false);
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santiago" }).format(date);
}

function renderMovements(items) {
  const body = byId("movement-rows");
  if (!items.length) {
    showTableMessage(body, 7, "Todavía no hay movimientos para estos filtros.");
    return;
  }
  const rows = items.map((movement) => {
    const row = document.createElement("tr");
    row.append(makeCell(formatDate(movement.fecha), "muted-cell"));
    const typeCell = document.createElement("td");
    const badge = document.createElement("span");
    const type = String(movement.tipo || "movimiento").toLowerCase();
    badge.className = `type-pill ${type.normalize("NFD").replace(/[\u0300-\u036f]/g, "")}`;
    badge.textContent = movement.tipo;
    typeCell.append(badge);
    row.append(typeCell);

    const productCell = document.createElement("td");
    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = movement.producto;
    const lot = document.createElement("small");
    lot.className = "product-sku";
    lot.textContent = `${movement.sku} · Lote ${movement.codigo_lote}`;
    productCell.append(name, lot);
    row.append(productCell);

    const amount = Number(movement.cantidad);
    row.append(makeCell(quantityFormat.format(amount), "price-cell"));
    row.append(makeCell(movement.usuario));
    row.append(makeCell(movement.motivo, "muted-cell"));
    const reference = movement.id_pedido
      ? "Pedido #" + movement.id_pedido
      : movement.id_nota_venta ? "NV #" + movement.id_nota_venta : "—";
    row.append(makeCell(reference, "muted-cell"));
    return row;
  });
  body.replaceChildren(...rows);
}

async function loadMovements() {
  const body = byId("movement-rows");
  showTableMessage(body, 7, "Cargando movimientos…");
  const params = new URLSearchParams({ limit: String(MOVEMENT_PAGE_SIZE), offset: String(movementState.offset) });
  const sku = byId("movement-sku").value.trim();
  const lot = byId("movement-lot").value.trim();
  if (sku) params.set("sku", sku);
  if (lot) params.set("codigo_lote", lot);
  try {
    const response = await fetch(`/inventory/movements?${params.toString()}`);
    if (!response.ok) throw new Error(`No se pudo cargar el historial (${response.status}).`);
    const result = await response.json();
    movementState.total = result.total;
    movementState.loaded = true;
    renderMovements(result.items || []);
    byId("movement-result-caption").textContent = result.total === 1 ? "1 movimiento encontrado" : `${quantityFormat.format(result.total)} movimientos encontrados`;
    updatePager("movement", movementState.total, movementState.offset, MOVEMENT_PAGE_SIZE);
    setApiStatus(true);
  } catch (error) {
    showTableMessage(body, 7, error.message || "No se pudo conectar con la API.", true);
    byId("movement-result-caption").textContent = "No fue posible cargar el historial";
    updatePager("movement", 0, 0, MOVEMENT_PAGE_SIZE);
    setApiStatus(false);
  }
}

function fillSelect(id, records, valueKey, labelKey) {
  const select = byId(id);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = records.length ? "Selecciona una opción" : "No hay opciones disponibles";
  select.replaceChildren(placeholder);
  for (const record of records) {
    const option = document.createElement("option");
    option.value = String(record[valueKey]);
    option.textContent = record[labelKey];
    select.append(option);
  }
  if (records.length === 1) select.value = String(records[0][valueKey]);
}

async function loadReceiptOptions() {
  try {
    const [optionsResponse, catalogResponse] = await Promise.all([
      fetch("/inventory/receipt-options"),
      fetch("/catalog/products?limit=100"),
    ]);
    if (!optionsResponse.ok || !catalogResponse.ok) throw new Error("No se pudieron cargar las opciones de recepción.");
    const options = await optionsResponse.json();
    const catalog = await catalogResponse.json();
    for (const id of ["receipt-single-warehouse", "receipt-bulk-warehouse", "receipt-excel-warehouse"]) {
      fillSelect(id, options.bodegas || [], "id_bodega", "nombre");
    }
    for (const id of ["receipt-single-operator", "receipt-bulk-operator", "receipt-excel-operator"]) {
      fillSelect(id, options.operadores || [], "id_usuario", "nombre");
    }
    receiptState.loaded = true;
    const datalist = byId("receipt-product-options");
    datalist.replaceChildren(...(catalog.items || []).map((product) => {
      const option = document.createElement("option");
      option.value = product.sku;
      option.label = product.nombre;
      return option;
    }));
  } catch (error) {
    setApiStatus(false);
    showReceiptResult("receipt-single-result", false, "No se cargaron las opciones", error.message);
  }
}

function showReceiptResult(id, success, title, message, errors = []) {
  const container = byId(id);
  container.className = `form-result ${success ? "success" : "error"}`;
  container.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const text = document.createElement("span");
  text.textContent = message;
  container.replaceChildren(heading, text);
  if (errors.length) {
    const list = document.createElement("ul");
    list.className = "bulk-error-list";
    for (const error of errors) {
      const item = document.createElement("li");
      item.textContent = `Fila ${error.row} · ${error.field}: ${error.message}`;
      list.append(item);
    }
    container.append(list);
  }
}

function refreshInventoryViews() {
  loadCatalog();
  if (movementState.loaded) loadMovements();
  if (saleState.loaded && byId("sale-warehouse").value) loadSalesCatalog();
}

async function submitSingleReceipt(event) {
  event.preventDefault();
  const payload = {
    sku: byId("receipt-sku").value.trim(),
    id_bodega: Number(byId("receipt-single-warehouse").value),
    codigo_lote: byId("receipt-lot").value.trim(),
    cantidad: byId("receipt-quantity").value,
    fecha_vencimiento: byId("receipt-expiration").value || null,
    id_usuario: Number(byId("receipt-single-operator").value),
    motivo: byId("receipt-reason").value.trim() || "Recepción de mercadería",
  };
  const result = byId("receipt-single-result");
  result.hidden = true;
  try {
    const response = await fetch("/inventory/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail || {};
      throw new Error(detail.message || "No se pudo registrar la recepción.");
    }
    showReceiptResult("receipt-single-result", true, "Recepción registrada", `${quantityFormat.format(Number(data.cantidad_recibida))} unidades añadidas al lote ${data.codigo_lote}. Total físico: ${quantityFormat.format(Number(data.cantidad_fisica_lote))}. El stock por bodega se consulta en Nota de venta.`);
    refreshInventoryViews();
  } catch (error) {
    showReceiptResult("receipt-single-result", false, "No se pudo registrar", error.message);
  }
}

function previewReceiptFile(file) {
  const preview = byId("receipt-file-preview");
  const submit = byId("receipt-bulk-submit");
  if (!file) {
    preview.hidden = true;
    submit.disabled = true;
    return;
  }
  preview.hidden = false;
  preview.replaceChildren();
  const summary = document.createElement("strong");
  summary.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  const lines = document.createElement("pre");
  file.text().then((content) => {
    lines.textContent = content.split(/\r?\n/).filter(Boolean).slice(0, 4).join("\n");
  }).catch(() => {
    lines.textContent = "No se pudo leer la vista previa.";
  });
  preview.append(summary, lines);
  submit.disabled = file.size === 0 || file.size > 5 * 1024 * 1024;
  byId("receipt-bulk-result").hidden = true;
  if (file.size > 5 * 1024 * 1024) {
    showReceiptResult("receipt-bulk-result", false, "Archivo demasiado grande", "El máximo permitido es 5 MiB.");
  }
}

async function submitBulkReceipt(event) {
  event.preventDefault();
  const file = byId("receipt-csv-file").files[0];
  if (!file) return;
  const button = byId("receipt-bulk-submit");
  button.disabled = true;
  button.textContent = "Validando y registrando…";
  byId("receipt-bulk-result").hidden = true;
  const params = new URLSearchParams({
    id_bodega: byId("receipt-bulk-warehouse").value,
    id_usuario: byId("receipt-bulk-operator").value,
  });
  try {
    const response = await fetch(`/inventory/receipts/import?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) {
      showReceiptResult("receipt-bulk-result", false, "No se registró ninguna fila", "Corrige los errores indicados y vuelve a cargar el archivo.", data.errors || []);
      return;
    }
    showReceiptResult("receipt-bulk-result", true, "Carga completada", `${data.received} recepciones registradas correctamente. Cada lote quedó asociado a su movimiento. El stock por bodega se consulta en Nota de venta.`);
    byId("receipt-bulk-form").reset();
    previewReceiptFile(null);
    refreshInventoryViews();
  } catch (error) {
    showReceiptResult("receipt-bulk-result", false, "No se pudo completar la carga", error.message || "No se pudo conectar con la API.");
  } finally {
    button.innerHTML = 'Validar y registrar <span aria-hidden="true">→</span>';
    button.disabled = !byId("receipt-csv-file").files[0];
  }
}

function downloadReceiptTemplate() {
  const content = "sku,codigo_lote,cantidad,fecha_vencimiento,motivo\nTKA311001901,L-ATUN-NUEVO,12,,Recepción de proveedor\n";
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "plantilla-recepciones.csv";
  link.click();
  URL.revokeObjectURL(url);
}


function renderExcelReceiptPreview(data) {
  const preview = byId("receipt-excel-preview");
  const summary = byId("receipt-excel-summary");
  const body = byId("receipt-excel-rows");
  const items = data.items || [];
  const errors = data.errors || [];
  const omitted = data.omitted_rows || [];
  const repeatedIdentifiers = omitted.filter((item) => ["duplicate_identifier_in_file", "duplicate_barcode_in_file"].includes(item.code));
  preview.hidden = false;
  summary.textContent = "Hoja " + (data.selected_sheet || "—") + " · " +
    quantityFormat.format(data.valid_rows || 0) + " de " + quantityFormat.format(data.total_rows || 0) +
    " filas listas · " + omitted.length + " omitidas por identificador ausente o repetido · " + items.filter((item) => item.producto_nuevo && item.status !== "omitted").length + " productos nuevos detectados · lote interno XLS-" + (data.batch_ref || "—");
  const visibleItems = items.slice(0, 30);
  if (!visibleItems.length) {
    showTableMessage(body, 7, "No hay filas que mostrar.");
  } else {
    const rows = visibleItems.map((item) => {
      const row = document.createElement("tr");
      row.append(
        makeCell(item.row),
        makeCell(item.sku),
        makeCell(item.nombre),
        makeCell(item.cantidad, "price-cell"),
        makeCell(item.codigo_lote),
        makeCell(item.fecha_vencimiento),
      );
      const stateCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "excel-state" + (item.status === "error" ? " error" : item.status === "new" ? " new" : item.status === "omitted" ? " omitted" : "");
      badge.textContent = item.status === "error" ? "Revisar" : item.status === "new" ? "Se creará" : item.status === "omitted" ? "Omitido" : "Existente";
      stateCell.append(badge);
      row.append(stateCell);
      return row;
    });
    body.replaceChildren(...rows);
  }
  if (items.length > visibleItems.length) {
    summary.textContent += " · vista de las primeras " + visibleItems.length + " filas";
  }
  if (errors.length) {
    showReceiptResult(
      "receipt-excel-result",
      false,
      errors.length + " error" + (errors.length === 1 ? "" : "es") + " en la planilla",
      "No se ha registrado inventario. Corrige estas filas y vuelve a analizar.",
      errors.concat(repeatedIdentifiers)
    );
  } else if (omitted.length) {
    showReceiptResult(
      "receipt-excel-result",
      true,
      "Vista previa lista con filas omitidas",
      omitted.length + " fila" + (omitted.length === 1 ? " omitida" : "s omitidas") + " por identificadores ausentes, repetidos o no únicos. Las demás filas identificadas sí pueden recibirse.",
      repeatedIdentifiers
    );
  } else {
    showReceiptResult(
      "receipt-excel-result",
      true,
      "Vista previa lista",
      "Los artículos existentes sumarán stock; los nuevos se crearán con los datos de la planilla. Aún no se ha guardado ningún movimiento."
    );
  }
  byId("receipt-excel-submit").disabled = errors.length > 0 || !data.valid_rows;
}

async function previewReceiptExcel() {
  const file = byId("receipt-excel-file").files[0];
  const result = byId("receipt-excel-result");
  const submit = byId("receipt-excel-submit");
  if (!file) return;
  excelReceiptState.preview = null;
  submit.disabled = true;
  byId("receipt-excel-preview").hidden = true;
  result.hidden = true;
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    showReceiptResult("receipt-excel-result", false, "No se puede analizar", "El archivo debe tener contenido y pesar como máximo 5 MiB.");
    return;
  }
  const params = new URLSearchParams();
  const sheet = byId("receipt-excel-sheet").value;
  const expiration = byId("receipt-excel-expiration").value;
  if (sheet) params.set("hoja", sheet);
  if (expiration) params.set("fecha_vencimiento", expiration);
  if (excelReceiptState.batchRef) params.set("batch_ref", excelReceiptState.batchRef);
  const select = byId("receipt-excel-sheet");
  select.disabled = true;
  try {
    const response = await fetch("/inventory/receipts/excel/preview?" + params.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data.errors && data.errors[0] && data.errors[0].message) || "No se pudo analizar la planilla.");
    excelReceiptState.preview = data;
    excelReceiptState.batchRef = data.batch_ref || null;
    const sheets = data.sheets || [];
    const selectedSheet = data.selected_sheet || "";
    const previousSheet = select.value;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = sheets.length ? "Selecciona una hoja" : "No se detectaron hojas compatibles";
    select.replaceChildren(placeholder);
    for (const item of sheets) {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = item.name + " · " + quantityFormat.format(item.rows) + " artículos";
      select.append(option);
    }
    select.disabled = sheets.length === 0;
    if (selectedSheet) select.value = selectedSheet;
    else if (sheets.some((item) => item.name === previousSheet)) select.value = previousSheet;
    if (data.items && data.items.length) renderExcelReceiptPreview(data);
    else if (data.errors && data.errors.length) {
      showReceiptResult("receipt-excel-result", false, "No se encontró una tabla compatible", data.errors[0].message, data.errors);
      byId("receipt-excel-preview").hidden = true;
    } else {
      byId("receipt-excel-preview").hidden = true;
      if (sheets.length > 1) {
        showReceiptResult("receipt-excel-result", true, "Elige la hoja que quieres recibir", "Se detectaron " + sheets.length + " hojas compatibles. Cada hoja puede tener precios distintos.");
      }
    }
  } catch (error) {
    showReceiptResult("receipt-excel-result", false, "No se pudo analizar", error.message || "No se pudo conectar con la API.");
  } finally {
    select.disabled = !excelReceiptState.preview || !(excelReceiptState.preview.sheets || []).length;
    submit.disabled = !excelReceiptState.preview || !!(excelReceiptState.preview.errors || []).length || !excelReceiptState.preview.valid_rows;
  }
}

async function submitExcelReceipt(event) {
  event.preventDefault();
  const file = byId("receipt-excel-file").files[0];
  const preview = excelReceiptState.preview;
  if (!file || !preview || preview.errors.length || !preview.valid_rows) return;
  const button = byId("receipt-excel-submit");
  button.disabled = true;
  button.textContent = "Validando y registrando…";
  byId("receipt-excel-result").hidden = true;
  const params = new URLSearchParams({
    id_bodega: byId("receipt-excel-warehouse").value,
    id_usuario: byId("receipt-excel-operator").value,
    hoja: preview.selected_sheet,
    batch_ref: preview.batch_ref,
    acepta_lote_interno: byId("receipt-excel-lot-confirm").checked,
  });
  const expiration = byId("receipt-excel-expiration").value;
  if (expiration) params.set("fecha_vencimiento", expiration);
  try {
    const response = await fetch("/inventory/receipts/excel/import?" + params.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) {
      const omittedDetails = Array.isArray(data.omitted_details) ? data.omitted_details : Array.isArray(data.omitted_rows) ? data.omitted_rows : [];
      const repeatedIdentifiers = omittedDetails.filter((item) => ["duplicate_identifier_in_file", "duplicate_barcode_in_file"].includes(item.code));
      showReceiptResult("receipt-excel-result", false, "No se registró ninguna fila", "Corrige los errores indicados y vuelve a analizar.", (data.errors || []).concat(repeatedIdentifiers));
      return;
    }
    showReceiptResult(
      "receipt-excel-result",
      true,
      "Recepción registrada",
      data.created_products + " productos nuevos creados y " + data.existing_products + " existentes con stock actualizado; " + (data.omitted_rows || 0) + " filas omitidas por identificadores ausentes, repetidos o no únicos. Se registró un movimiento auditable por artículo. Referencia de lote: XLS-" + data.batch_ref + ".",
      (data.omitted_details || []).filter((item) => ["duplicate_identifier_in_file", "duplicate_barcode_in_file"].includes(item.code))
    );
    byId("receipt-excel-form").reset();
    excelReceiptState.batchRef = null;
    excelReceiptState.preview = null;
    byId("receipt-excel-preview").hidden = true;
    byId("receipt-excel-sheet").replaceChildren(new Option("Primero selecciona un Excel", ""));
    byId("receipt-excel-sheet").disabled = true;
    refreshInventoryViews();
  } catch (error) {
    showReceiptResult("receipt-excel-result", false, "No se pudo completar la carga", error.message || "No se pudo conectar con la API.");
  } finally {
    button.textContent = "Crear y recibir artículos →";
    button.disabled = !excelReceiptState.preview || !!(excelReceiptState.preview.errors || []).length;
  }
}
function setSaleCategoryOptions(categories) {
  const select = byId("sale-category");
  const selected = select.value;
  select.replaceChildren(select.options[0]);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.append(option);
  }
  if (categories.includes(selected)) select.value = selected;
}

function renderSalesCatalog(items) {
  const body = byId("sale-product-rows");
  if (!items.length) {
    showTableMessage(body, 6, "No hay productos disponibles para esos filtros.");
    return;
  }
  const rows = items.map((product) => {
    saleState.productCache.set(product.sku, product);
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = product.nombre;
    const sku = document.createElement("small");
    sku.className = "product-sku";
    sku.textContent = product.sku;
    nameCell.append(name, sku);
    row.append(nameCell, makeCell(money.format(Number(product.precio_vigente)), "price-cell"));

    const available = Number(product.disponible || 0);
    row.append(makeCell(quantityFormat.format(available)));
    row.append(makeCell(quantityFormat.format(Number(product.unidades_por_caja)) + " por caja"));

    const selected = saleState.selection.get(product.sku) || { cajas: 0, sueltos: 0 };
    const boxesCell = document.createElement("td");
    const boxesInput = document.createElement("input");
    boxesInput.type = "number";
    boxesInput.min = "0";
    boxesInput.max = String(Math.floor(available / Number(product.unidades_por_caja)));
    boxesInput.step = "1";
    boxesInput.value = selected.cajas || "";
    boxesInput.dataset.saleQty = "cajas";
    boxesInput.dataset.sku = product.sku;
    boxesInput.setAttribute("aria-label", "Cajas de " + product.nombre);
    boxesCell.append(boxesInput);
    row.append(boxesCell);

    const looseCell = document.createElement("td");
    const looseInput = document.createElement("input");
    looseInput.type = "number";
    looseInput.min = "0";
    looseInput.max = String(available);
    looseInput.step = String(10 ** -Number(product.decimales || 0));
    looseInput.value = selected.sueltos || "";
    looseInput.dataset.saleQty = "sueltos";
    looseInput.dataset.sku = product.sku;
    looseInput.setAttribute("aria-label", "Unidades sueltas de " + product.nombre);
    looseCell.append(looseInput);
    row.append(looseCell);
    return row;
  });
  body.replaceChildren(...rows);
}

async function loadSalesCatalog() {
  const warehouse = byId("sale-warehouse").value;
  const body = byId("sale-product-rows");
  if (!warehouse) {
    showTableMessage(body, 6, "Selecciona una bodega para consultar su stock.");
    return;
  }
  showTableMessage(body, 6, "Cargando productos…");
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(saleState.offset), id_bodega: warehouse });
  const query = byId("sale-query").value.trim();
  const category = byId("sale-category").value;
  if (query) params.set("q", query);
  if (category) params.set("categoria", category);
  try {
    const response = await fetch("/catalog/products?" + params.toString());
    if (!response.ok) throw new Error("No se pudo cargar el catálogo (" + response.status + ").");
    const result = await response.json();
    saleState.total = result.total;
    saleState.items = result.items || [];
    saleState.loaded = true;
    setSaleCategoryOptions(result.categories || []);
    renderSalesCatalog(saleState.items);
    byId("sale-catalog-caption").textContent = quantityFormat.format(result.total) + " productos en el catálogo";
    const start = result.total ? saleState.offset + 1 : 0;
    const end = Math.min(saleState.offset + PAGE_SIZE, result.total);
    byId("sale-page-label").textContent = result.total ? "Mostrando " + start + "–" + end + " de " + result.total : "Sin resultados";
    byId("sale-prev").disabled = saleState.offset <= 0;
    byId("sale-next").disabled = saleState.offset + PAGE_SIZE >= result.total;
  } catch (error) {
    showTableMessage(body, 6, error.message || "No se pudo conectar con la API.", true);
    byId("sale-catalog-caption").textContent = "No fue posible cargar el catálogo";
    saleState.total = 0;
    byId("sale-page-label").textContent = "Sin resultados";
    byId("sale-prev").disabled = true;
    byId("sale-next").disabled = true;
  }
}

function renderSaleSummary() {
  const body = byId("sale-summary-rows");
  const selected = [...saleState.selection.entries()]
    .filter(([, values]) => Number(values.cajas) > 0 || Number(values.sueltos) > 0);
  if (!selected.length) {
    showTableMessage(body, 6, "Agrega productos desde el catálogo.");
    byId("sale-line-count").textContent = "0 PRODUCTOS";
    byId("sale-total").textContent = money.format(0);
    byId("sale-submit").disabled = true;
    return;
  }
  let total = 0;
  const rows = selected.map(([sku, values]) => {
    const product = saleState.productCache.get(sku);
    if (!product) return null;
    const boxes = Number(values.cajas) || 0;
    const loose = Number(values.sueltos) || 0;
    const quantity = boxes * Number(product.unidades_por_caja) + loose;
    const subtotal = Math.round(Number(product.precio_vigente) * quantity * 100) / 100;
    total += subtotal;
    const row = document.createElement("tr");
    const productCell = document.createElement("td");
    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = product.nombre;
    const code = document.createElement("small");
    code.className = "product-sku";
    code.textContent = product.sku;
    productCell.append(name, code);
    row.append(productCell);
    row.append(makeCell(quantityFormat.format(boxes)));
    row.append(makeCell(quantityFormat.format(loose)));
    row.append(makeCell(quantityFormat.format(quantity)));
    row.append(makeCell(money.format(subtotal), "price-cell"));
    const removeCell = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-sale-item";
    remove.textContent = "Quitar";
    remove.dataset.removeSaleSku = sku;
    removeCell.append(remove);
    row.append(removeCell);
    return row;
  }).filter(Boolean);
  body.replaceChildren(...rows);
  byId("sale-line-count").textContent = selected.length + (selected.length === 1 ? " PRODUCTO" : " PRODUCTOS");
  byId("sale-total").textContent = money.format(total);
  byId("sale-submit").disabled = false;
}

function loadSaleOptions() {
  fetch("/sales/options")
    .then((response) => {
      if (!response.ok) throw new Error("No se pudieron cargar vendedores y bodegas.");
      return response.json();
    })
    .then((options) => {
      fillSelect("sale-seller", options.vendedores || [], "id_usuario", "nombre");
      fillSelect("sale-warehouse", options.bodegas || [], "id_bodega", "nombre");
      saleState.optionsLoaded = true;
      if (byId("sale-warehouse").value) loadSalesCatalog();
    })
    .catch((error) => {
      showReceiptResult("sale-result", false, "No se cargaron las opciones", error.message);
    });
}

function showSaleResult(data) {
  const container = byId("sale-result");
  container.className = "form-result success";
  container.hidden = false;
  const heading = document.createElement("strong");
  heading.textContent = "Nota de venta #" + data.id_nota_venta + " registrada";
  const message = document.createElement("span");
  message.textContent = "Vendedor: " + data.vendedor + " · Bodega: " + data.bodega + " · Total: " + money.format(Number(data.total)) + ". El stock y los movimientos quedaron actualizados.";
  container.replaceChildren(heading, message);
}

async function submitSaleNote() {
  const items = [...saleState.selection.entries()]
    .filter(([, values]) => Number(values.cajas) > 0 || Number(values.sueltos) > 0)
    .map(([sku, values]) => ({ sku, cajas: Number(values.cajas) || 0, sueltos: String(Number(values.sueltos) || 0) }));
  if (!items.length) return;
  const button = byId("sale-submit");
  button.disabled = true;
  button.textContent = "Registrando nota…";
  byId("sale-result").hidden = true;
  try {
    const response = await fetch("/sales/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_vendedor: Number(byId("sale-seller").value),
        id_bodega: Number(byId("sale-warehouse").value),
        items,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail || {};
      throw new Error(detail.message || "No se pudo registrar la nota de venta.");
    }
    showSaleResult(data);
    saleState.selection.clear();
    renderSaleSummary();
    renderSalesCatalog(saleState.items);
    refreshInventoryViews();
  } catch (error) {
    showReceiptResult("sale-result", false, "No se pudo registrar", error.message);
  } finally {
    button.innerHTML = 'Registrar nota de venta <span aria-hidden="true">→</span>';
    renderSaleSummary();
  }
}

byId("sale-product-rows").addEventListener("input", (event) => {
  const input = event.target.closest("[data-sale-qty]");
  if (!input) return;
  const product = saleState.productCache.get(input.dataset.sku);
  if (!product) return;
  const values = saleState.selection.get(input.dataset.sku) || { cajas: 0, sueltos: 0 };
  const value = Math.max(0, Number(input.value) || 0);
  if (input.dataset.saleQty === "cajas") {
    values.cajas = Math.floor(value);
    input.value = values.cajas || "";
  } else values.sueltos = value;
  saleState.selection.set(input.dataset.sku, values);
  renderSaleSummary();
});

byId("sale-summary-rows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-sale-sku]");
  if (!button) return;
  saleState.selection.delete(button.dataset.removeSaleSku);
  renderSalesCatalog(saleState.items);
  renderSaleSummary();
});

byId("sale-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  saleState.offset = 0;
  loadSalesCatalog();
});
byId("sale-clear-filter").addEventListener("click", () => {
  byId("sale-query").value = "";
  byId("sale-category").value = "";
  saleState.offset = 0;
  loadSalesCatalog();
});
byId("sale-category").addEventListener("change", () => {
  saleState.offset = 0;
  loadSalesCatalog();
});
byId("sale-prev").addEventListener("click", () => {
  saleState.offset = Math.max(0, saleState.offset - PAGE_SIZE);
  loadSalesCatalog();
});
byId("sale-next").addEventListener("click", () => {
  if (saleState.offset + PAGE_SIZE < saleState.total) {
    saleState.offset += PAGE_SIZE;
    loadSalesCatalog();
  }
});
byId("sale-warehouse").addEventListener("change", () => {
  saleState.selection.clear();
  saleState.offset = 0;
  renderSaleSummary();
  loadSalesCatalog();
});
byId("sale-submit").addEventListener("click", submitSaleNote);


for (const button of document.querySelectorAll(".mode-button")) {
  button.addEventListener("click", () => {
    const bulk = button.dataset.receiptMode === "bulk";
    document.querySelectorAll(".mode-button").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    byId("single-receipt-panel").hidden = bulk;
    byId("single-receipt-panel").classList.toggle("active", !bulk);
    byId("bulk-receipt-panel").hidden = !bulk;
    byId("bulk-receipt-panel").classList.toggle("active", bulk);
  });
}
byId("receipt-single-form").addEventListener("submit", submitSingleReceipt);
byId("receipt-bulk-form").addEventListener("submit", submitBulkReceipt);
byId("receipt-csv-file").addEventListener("change", (event) => previewReceiptFile(event.target.files[0]));
byId("bulk-template").addEventListener("click", downloadReceiptTemplate);
byId("receipt-excel-form").addEventListener("submit", submitExcelReceipt);
byId("receipt-excel-file").addEventListener("change", () => {
  excelReceiptState.batchRef = null;
  excelReceiptState.preview = null;
  byId("receipt-excel-sheet").replaceChildren(new Option("Analizando hojas…", ""));
  byId("receipt-excel-sheet").disabled = true;
  previewReceiptExcel();
});
byId("receipt-excel-sheet").addEventListener("change", () => previewReceiptExcel());
byId("receipt-excel-expiration").addEventListener("change", () => {
  if (byId("receipt-excel-file").files[0]) previewReceiptExcel();
});
for (const button of document.querySelectorAll(".format-button")) {
  button.addEventListener("click", () => {
    const excel = button.dataset.bulkFormat === "excel";
    document.querySelectorAll(".format-button").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-selected", String(item === button));
    });
    byId("receipt-bulk-form").hidden = excel;
    byId("receipt-excel-form").hidden = !excel;
    byId("receipt-bulk-result").hidden = excel;
    byId("receipt-excel-result").hidden = !excel;
  });
}
for (const button of document.querySelectorAll(".nav-item")) {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".view").forEach((view) => {
      const active = view.id === button.dataset.view;
      view.classList.toggle("active", active);
      view.hidden = !active;
    });
    const titles = { "catalog-view": "Catálogo", "receipt-view": "Recepción", "movement-view": "Movimientos", "sales-view": "Nota de venta" };
    byId("section-breadcrumb").textContent = titles[button.dataset.view];
    if (button.dataset.view === "movement-view" && !movementState.loaded) loadMovements();
    if (button.dataset.view === "receipt-view" && !receiptState.loaded) loadReceiptOptions();
    if (button.dataset.view === "sales-view" && !saleState.optionsLoaded) loadSaleOptions();
  });
}

byId("catalog-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  catalogState.offset = 0;
  loadCatalog();
});
byId("catalog-inactive-toggle").addEventListener("click", () => {
  catalogState.includeInactive = !catalogState.includeInactive;
  catalogState.offset = 0;
  loadCatalog();
});byId("catalog-refresh").addEventListener("click", () => {
  byId("catalog-query").value = "";
  catalogState.offset = 0;
  loadCatalog();
});
byId("catalog-clear").addEventListener("click", () => {
  byId("catalog-query").value = "";
  catalogState.offset = 0;
  loadCatalog();
});
byId("catalog-prev").addEventListener("click", () => {
  catalogState.offset = Math.max(0, catalogState.offset - PAGE_SIZE);
  loadCatalog();
});
byId("catalog-next").addEventListener("click", () => {
  if (catalogState.offset + PAGE_SIZE < catalogState.total) {
    catalogState.offset += PAGE_SIZE;
    loadCatalog();
  }
});
byId("movement-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  movementState.offset = 0;
  loadMovements();
});
byId("movement-clear").addEventListener("click", () => {
  byId("movement-sku").value = "";
  byId("movement-lot").value = "";
  movementState.offset = 0;
  loadMovements();
});
byId("movement-prev").addEventListener("click", () => {
  movementState.offset = Math.max(0, movementState.offset - MOVEMENT_PAGE_SIZE);
  loadMovements();
});
byId("movement-next").addEventListener("click", () => {
  if (movementState.offset + MOVEMENT_PAGE_SIZE < movementState.total) {
    movementState.offset += MOVEMENT_PAGE_SIZE;
    loadMovements();
  }
});

fetch("/health").then((response) => setApiStatus(response.ok)).catch(() => setApiStatus(false));
loadCatalog();















