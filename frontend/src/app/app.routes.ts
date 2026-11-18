import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'catalogo' },
  {
    path: 'catalogo',
    title: 'Catálogo · GHOSH',
    data: { label: 'Catálogo' },
    loadComponent: () => import('./features/catalog/catalog-page.component').then((m) => m.CatalogPageComponent),
  },
  {
    path: 'ventas',
    title: 'Nota de venta · GHOSH',
    data: { label: 'Nota de venta' },
    loadComponent: () => import('./features/sales/sales-page.component').then((m) => m.SalesPageComponent),
  },
  {
    path: 'pedidos',
    title: 'Pedidos · GHOSH',
    data: { label: 'Pedidos' },
    loadComponent: () => import('./features/orders/orders-page.component').then((m) => m.OrdersPageComponent),
  },
  {
    path: 'notas-venta',
    title: 'Auditoría de ventas · GHOSH',
    data: { label: 'Auditoría de ventas' },
    loadComponent: () =>
      import('./features/sales-audit/sales-audit-page.component').then((m) => m.SalesAuditPageComponent),
  },
  {
    path: 'recepcion',
    title: 'Recepción · GHOSH',
    data: { label: 'Recepción' },
    loadComponent: () => import('./features/receipt/receipt-page.component').then((m) => m.ReceiptPageComponent),
  },
  {
    path: 'movimientos',
    title: 'Movimientos · GHOSH',
    data: { label: 'Movimientos' },
    loadComponent: () => import('./features/movements/movements-page.component').then((m) => m.MovementsPageComponent),
  },
  {
    path: 'demanda',
    title: 'Demanda y alertas · GHOSH',
    data: { label: 'Demanda y alertas' },
    loadComponent: () =>
      import('./features/demand-alerts/demand-alerts-page.component').then((m) => m.DemandAlertsPageComponent),
  },
  { path: '**', redirectTo: 'catalogo' },
];
