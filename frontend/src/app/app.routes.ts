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
  { path: '**', redirectTo: 'catalogo' },
];
