import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import {
  AlertTriangle,
  ArrowUpDown,
  Check,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  LayoutGrid,
  Lock,
  LogOut,
  LucideAngularModule,
  PackagePlus,
  PanelLeft,
  PanelLeftClose,
  ReceiptText,
  Settings,
  User,
  Users,
  X,
} from 'lucide-angular';
import { filter } from 'rxjs';

import { AuthService } from './core/auth.service';
import { GhoshApiService } from './core/ghosh-api.service';
import { GlassConfirmModalComponent } from './shared/glass-confirm-modal.component';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    GlassConfirmModalComponent,
  ],
  template: `
    @if (!auth.isAuthenticated()) {
      <!-- ==================== PANTALLA DE INICIO DE SESIÓN (SaaS Dark Minimalista) ==================== -->
      <div class="min-h-dvh bg-[#0a0a0a] text-[#fafafa] flex flex-col justify-center items-center p-6">
        <div class="w-full max-w-[380px] bg-[#111111] border border-[#262626] rounded-[10px] p-8 animate-fade-up">
          <div class="flex items-center gap-3 mb-6">
            <span
              class="w-7 h-7 rounded-[6px] bg-[#fafafa] text-[#0a0a0a] grid place-items-center text-[13px] font-bold"
            >
              G
            </span>
            <span class="text-[14px] font-semibold tracking-tight text-[#fafafa]">
              GHOSH Workspace
            </span>
          </div>

          <h1 class="text-[20px] font-semibold text-[#fafafa] tracking-tight">
            Iniciar sesión
          </h1>
          <p class="mt-1.5 text-[13px] text-[#a1a1aa]">
            Ingresa tus credenciales para acceder al panel de inventario y ventas.
          </p>

          <form class="mt-6 space-y-4" (ngSubmit)="onLoginSubmit()">
            <label class="block">
              <span class="field-label">Usuario</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.User" [size]="16" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  [(ngModel)]="loginUsername"
                  placeholder="admin"
                  autocomplete="username"
                  required
                  class="glass-input has-icon pl-10"
                />
              </div>
            </label>

            <label class="block">
              <span class="field-label">Contraseña</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.Lock" [size]="16" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  [(ngModel)]="loginPassword"
                  placeholder="••••••••"
                  autocomplete="current-password"
                  required
                  class="glass-input has-icon pl-10"
                />
              </div>
            </label>

            @if (loginError()) {
              <div
                role="alert"
                class="p-3 rounded-[6px] bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#fafafa]"
              >
                {{ loginError() }}
              </div>
            }

            <button type="submit" class="btn btn-primary w-full mt-2">
              Continuar
            </button>
          </form>

          <div class="mt-6 pt-4 border-t border-[#1f1f1f] flex items-center justify-between text-[12px] text-[#a1a1aa]">
            <span>Acceso por defecto</span>
            <code class="px-2 py-0.5 rounded bg-[#0a0a0a] border border-[#262626] text-[#fafafa] font-mono text-[11px]">
              admin / admin
            </code>
          </div>
        </div>
      </div>
    } @else {
      <!-- ==================== SHELL PRINCIPAL (Desktop + Redmi Pad SE 11" Vertical + Simulador PC) ==================== -->
      <div
        [class.min-h-dvh]="true"
        [class.bg-[#050505]]="tabletSimMode()"
        [class.bg-[#0a0a0a]]="!tabletSimMode()"
        [class.p-3]="tabletSimMode()"
        [class.sm:p-6]="tabletSimMode()"
        [class.tablet-sim-active]="tabletSimMode()"
        [class.tablet-sim-portrait]="tabletSimMode() && tabletOrientation() === 'portrait'"
      >
        @if (tabletSimMode()) {
          <div class="max-w-[1024px] mx-auto mb-4 px-4 py-2.5 rounded-[10px] border border-[#262626] bg-[#111111] flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2.5 text-[12px]">
              <span class="badge badge-emerald">Simulador Tablet</span>
              <strong class="text-[#fafafa]">Xiaomi Redmi Pad SE 11" (16:10)</strong>
              <span class="text-[#a1a1aa]">
                {{
                  tabletOrientation() === 'portrait'
                    ? 'Vertical · 1200 × 1920 px físicos FHD+ (750 × 1200 px CSS)'
                    : 'Horizontal · 1920 × 1200 px físicos FHD+ (1024 × 640 px CSS)'
                }}
              </span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              @if (pwaInstallPrompt()) {
                <button
                  id="pwa-install-btn"
                  type="button"
                  class="btn btn-sm btn-primary"
                  (click)="installPwa()"
                >
                  Instalar App (PWA)
                </button>
              }
              <button
                type="button"
                class="btn btn-sm"
                [ngClass]="tabletOrientation() === 'portrait' ? 'btn-primary' : 'btn-ghost'"
                (click)="tabletOrientation.set('portrait')"
              >
                Vertical (Portrait)
              </button>
              <button
                type="button"
                class="btn btn-sm"
                [ngClass]="tabletOrientation() === 'landscape' ? 'btn-primary' : 'btn-ghost'"
                (click)="tabletOrientation.set('landscape')"
              >
                Horizontal
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                (click)="toggleTabletSimMode()"
              >
                Volver a escritorio
              </button>
            </div>
          </div>
        }

        <div
          [ngClass]="
            tabletSimMode()
              ? (tabletOrientation() === 'portrait'
                  ? 'tablet-sim-frame tablet-bezel-portrait text-[#fafafa] flex relative'
                  : 'tablet-sim-frame tablet-bezel-landscape text-[#fafafa] flex relative')
              : 'min-h-dvh bg-[#0a0a0a] text-[#fafafa] flex relative'
          "
        >
        <!-- Overlay del Drawer en Tablet / Móvil (< lg o dentro del simulador) -->
        @if (mobileDrawerOpen()) {
          <div
            class="z-40 bg-black/75 animate-fade-in"
            [ngClass]="tabletSimMode() ? 'absolute inset-0' : 'fixed inset-0 lg:hidden'"
            (click)="mobileDrawerOpen.set(false)"
            aria-hidden="true"
          ></div>
        }

        <!-- SIDEBAR IZQUIERDO (~240px en escritorio >= 1024px; slide-over táctil dentro de la pantalla tablet) -->
        @if (mobileDrawerOpen() || (!tabletSimMode() && !sidebarCollapsed())) {
          <aside
            class="w-[240px] shrink-0 bg-[#0a0a0a] border-r border-white/85 flex flex-col select-none z-50"
            [ngClass]="{
              'absolute inset-y-0 left-0 h-full': mobileDrawerOpen() && tabletSimMode(),
              'fixed inset-y-0 left-0 h-dvh': mobileDrawerOpen() && !tabletSimMode(),
              'hidden lg:flex lg:sticky lg:top-0 h-dvh': !mobileDrawerOpen() && !tabletSimMode()
            }"
          >
            <!-- Cabecera del Sidebar: Selector de Workspace + Botón colapsar -->
            <div class="h-14 px-3.5 flex items-center justify-between gap-2">
              <button
                type="button"
                (click)="toggleWorkspaceMenu()"
                class="flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] hover:bg-[#171717] transition-colors duration-150 min-w-0 flex-1 text-left"
              >
                <span
                  class="w-5 h-5 rounded-[5px] bg-[#fafafa] text-[#0a0a0a] grid place-items-center text-[11px] font-bold shrink-0"
                >
                  G
                </span>
                <span class="text-[14px] font-bold text-[#fafafa] truncate">
                  GHOSH
                </span>
                <lucide-icon
                  [img]="icons.ChevronDown"
                  [size]="15"
                  [strokeWidth]="1.5"
                  class="text-[#a1a1aa] ml-auto shrink-0"
                ></lucide-icon>
              </button>

              <button
                type="button"
                (click)="collapseSidebar()"
                title="Colapsar barra lateral"
                aria-label="Colapsar barra lateral"
                class="w-7 h-7 rounded-[6px] grid place-items-center text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#171717] transition-colors duration-150 shrink-0"
              >
                <lucide-icon [img]="icons.PanelLeftClose" [size]="16" [strokeWidth]="1.5"></lucide-icon>
              </button>
            </div>

            <!-- Navegación Principal Arriba (gap vertical ~12px, letra 13px, padding 8px 12px) -->
            <nav class="px-3 pt-3 flex flex-col gap-[12px]" aria-label="Secciones principales">
              @for (item of navItems; track item.path) {
                <a
                  [routerLink]="item.path"
                  routerLinkActive="nav-link-active"
                  (click)="mobileDrawerOpen.set(false)"
                  class="nav-link"
                >
                  <lucide-icon [img]="item.icon" [size]="17" [strokeWidth]="1.5"></lucide-icon>
                  <span>{{ item.label }}</span>
                </a>
              }
            </nav>

            <!-- Acciones Secundarias Ancladas Abajo (margin-top: auto) -->
            <div class="mt-auto px-3 pb-4 pt-4 border-t border-[#1f1f1f] flex flex-col gap-[12px]">
              <button
                type="button"
                class="nav-link"
                (click)="activeSecondaryModal.set('team'); mobileDrawerOpen.set(false)"
              >
                <lucide-icon [img]="icons.Users" [size]="17" [strokeWidth]="1.5"></lucide-icon>
                <span>Equipo</span>
              </button>

              <button
                type="button"
                class="nav-link"
                (click)="activeSecondaryModal.set('settings'); mobileDrawerOpen.set(false)"
              >
                <lucide-icon [img]="icons.Settings" [size]="17" [strokeWidth]="1.5"></lucide-icon>
                <span>Ajustes</span>
              </button>

              <button
                type="button"
                class="nav-link"
                (click)="onLogout()"
              >
                <lucide-icon [img]="icons.LogOut" [size]="17" [strokeWidth]="1.5"></lucide-icon>
                <span>Cerrar sesión</span>
              </button>
            </div>
          </aside>
        }

        <!-- COLUMNA DERECHA: Header Superior + Contenido Desplazable + Barra Táctil Fija -->
        <div
          [ngClass]="
            tabletSimMode()
              ? 'flex-1 flex flex-col min-w-0 h-full overflow-hidden'
              : 'flex-1 flex flex-col min-w-0'
          "
        >
          <!-- HEADER SUPERIOR (fijo arriba) -->
          <header
            class="sticky top-0 z-30 h-14 px-4 sm:px-8 flex items-center justify-between bg-[#0a0a0a]/90 backdrop-blur-md border-b border-[#1f1f1f] shrink-0"
          >
            <div class="flex items-center gap-2 relative">
              <!-- Botón para abrir/colapsar el Sidebar -->
              <button
                type="button"
                (click)="toggleSidebar()"
                title="Alternar menú lateral"
                aria-label="Alternar menú lateral"
                class="w-8 h-8 rounded-[6px] grid place-items-center text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#171717] transition-colors duration-150"
              >
                <lucide-icon [img]="icons.PanelLeft" [size]="17" [strokeWidth]="1.5"></lucide-icon>
              </button>

              <span class="text-[#262626] select-none">/</span>

              <!-- Selector desplegable de Workspace / Funcionalidad (14px negrita blanca + chevron) -->
              <button
                type="button"
                (click)="toggleHeaderDropdown($event)"
                class="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] hover:bg-[#171717] transition-colors duration-150"
              >
                <strong id="section-breadcrumb" class="text-[14px] font-bold text-[#fafafa]">
                  {{ currentSection() }}
                </strong>
                <lucide-icon
                  [img]="icons.ChevronDown"
                  [size]="15"
                  [strokeWidth]="1.5"
                  class="text-[#a1a1aa]"
                ></lucide-icon>
              </button>

              <!-- Menú desplegable rápido de funcionalidades -->
              @if (headerDropdownOpen()) {
                <div
                  class="absolute left-9 top-11 z-50 w-56 p-1.5 bg-[#111111] border border-[#262626] rounded-[8px] animate-fade-up"
                  (click)="$event.stopPropagation()"
                >
                  <div class="px-2.5 py-1.5 text-[11px] font-medium text-[#a1a1aa]">
                    Cambiar funcionalidad
                  </div>
                  @for (item of navItems; track item.path) {
                    <a
                      [routerLink]="item.path"
                      (click)="headerDropdownOpen.set(false)"
                      class="flex items-center justify-between px-2.5 py-2 rounded-[6px] text-[13px] text-[#a1a1aa] hover:bg-[#171717] hover:text-[#fafafa] no-underline transition-colors duration-150"
                      [class.text-[#fafafa]]="currentSection() === item.label"
                      [class.bg-[#1f1f1f]]="currentSection() === item.label"
                    >
                      <span class="flex items-center gap-2.5">
                        <lucide-icon [img]="item.icon" [size]="16" [strokeWidth]="1.5"></lucide-icon>
                        <span>{{ item.label }}</span>
                      </span>
                      @if (currentSection() === item.label) {
                        <lucide-icon [img]="icons.Check" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                      }
                    </a>
                  }
                </div>
              }
            </div>

            <!-- Estado de la API, simulador Redmi Pad SE y usuario activo -->
            <div class="flex items-center gap-2 sm:gap-3">
              <button
                id="tablet-sim-toggle"
                type="button"
                (click)="toggleTabletSimMode()"
                title="Previsualizar interfaz táctil de Xiaomi Redmi Pad SE 11 pulgadas en el PC"
                class="btn btn-sm"
                [ngClass]="tabletSimMode() ? 'btn-primary' : 'btn-ghost'"
              >
                <lucide-icon [img]="icons.LayoutGrid" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                <span class="hidden sm:inline">{{ tabletSimMode() ? 'Salir Vista Tablet' : 'Vista Redmi Pad SE' }}</span>
                <span class="sm:hidden">Tablet</span>
              </button>

              <button
                type="button"
                id="api-status"
                (click)="refreshHealth()"
                title="Verificar estado de la API y PostgreSQL"
                class="inline-flex items-center gap-2 px-2.5 py-1 rounded-[6px] text-[12px] font-medium border border-[#262626] bg-[#111111] hover:bg-[#171717] transition-colors duration-150"
                [class.offline]="api.apiOnline() === false"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  [ngClass]="{
                    'bg-[#fafafa]': api.apiOnline() === true,
                    'bg-[#52525b]': api.apiOnline() !== true
                  }"
                ></span>
                <span class="text-[#a1a1aa]">
                  @if (api.apiOnline() === true) {
                    API conectada
                  } @else if (api.apiOnline() === false) {
                    API sin conexión
                  } @else {
                    Conectando
                  }
                </span>
              </button>

              <div
                class="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-[6px] border border-[#262626] bg-[#111111] text-[12px] text-[#a1a1aa]"
              >
                <lucide-icon [img]="icons.User" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                <span class="text-[#fafafa] font-medium">{{ auth.currentUser() }}</span>
              </div>
            </div>
          </header>

          <!-- ÁREA DESPLAZABLE (en modo simulador scrollea por dentro manteniendo cabecera y barra inferior siempre visibles) -->
          <div
            #contentScroller
            [ngClass]="
              tabletSimMode()
                ? 'flex-1 overflow-y-auto overflow-x-hidden scroll-area flex flex-col'
                : 'flex-1 flex flex-col'
            "
          >
            <main
              class="flex-1 w-full max-w-[1440px] mx-auto p-5 sm:p-8"
              [ngClass]="tabletSimMode() ? 'pb-8' : 'pb-24 lg:pb-8'"
            >
              <router-outlet />
            </main>

            <!-- Pie de página minimalista -->
            <footer
              class="w-full max-w-[1440px] mx-auto px-5 sm:px-8 py-6 border-t border-[#1f1f1f] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[12px] text-[#a1a1aa]"
            >
              <span>GHOSH · Sistema de inventario, pedidos y notas de venta</span>
              <span>Bodega Central Talca · America/Santiago</span>
            </footer>
          </div>

          <!-- Barra de navegación táctil inferior fija en todo momento del scroll -->
          <nav
            aria-label="Navegación táctil rápida"
            class="tablet-bottom-bar grid-cols-5 border-t border-[#262626] bg-[#0a0a0a]/95 backdrop-blur-md px-1 py-1.5 shrink-0"
          >
            @for (item of quickTabletNavItems; track item.path) {
              <a
                [routerLink]="item.path"
                routerLinkActive="!text-[#fafafa] bg-[#1f1f1f]"
                (click)="contentScroller.scrollTop = 0; mobileDrawerOpen.set(false)"
                class="min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-[8px] px-1 py-1 text-[11px] font-medium text-[#a1a1aa] hover:text-[#fafafa] no-underline transition-colors"
              >
                <lucide-icon [img]="item.icon" [size]="17" [strokeWidth]="1.5"></lucide-icon>
                <span class="truncate max-w-full">{{ item.shortLabel }}</span>
              </a>
            }
            <button
              type="button"
              (click)="mobileDrawerOpen.set(true)"
              class="min-h-[48px] flex flex-col items-center justify-center gap-1 rounded-[8px] px-1 py-1 text-[11px] font-medium text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
            >
              <lucide-icon [img]="icons.PanelLeft" [size]="17" [strokeWidth]="1.5"></lucide-icon>
              <span>Menú</span>
            </button>
          </nav>
        </div>
        </div>
      </div>

      <!-- ==================== MODAL DE EQUIPO / AJUSTES ==================== -->
      @if (activeSecondaryModal(); as modalType) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-fade-in"
          role="dialog"
          aria-modal="true"
          (click)="activeSecondaryModal.set(null)"
        >
          <div
            class="w-full max-w-md p-6 bg-[#111111] border border-[#262626] rounded-[10px] animate-modal-in relative"
            (click)="$event.stopPropagation()"
          >
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-icon absolute top-4 right-4 text-[#a1a1aa]"
              aria-label="Cerrar"
              (click)="activeSecondaryModal.set(null)"
            >
              <lucide-icon [img]="icons.X" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </button>

            @if (modalType === 'team') {
              <div class="flex items-center gap-2.5 mb-4">
                <lucide-icon [img]="icons.Users" [size]="18" [strokeWidth]="1.5"></lucide-icon>
                <h2 class="text-[16px] font-semibold text-[#fafafa]">Equipo de operación</h2>
              </div>
              <p class="text-[13px] text-[#a1a1aa] mb-4">
                Usuarios habilitados en la operación de GHOSH y sus roles de acceso.
              </p>
              <div class="space-y-2">
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <div>
                    <div class="text-[13px] font-medium text-[#fafafa]">admin (Sesión actual)</div>
                    <div class="text-[12px] text-[#a1a1aa]">Administrador general</div>
                  </div>
                  <span class="badge">Activo</span>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <div>
                    <div class="text-[13px] font-medium text-[#fafafa]">Bodega Demo</div>
                    <div class="text-[12px] text-[#a1a1aa]">bodega&#64;demo.cl · Recepción de lotes</div>
                  </div>
                  <span class="badge">Rol: bodega</span>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <div>
                    <div class="text-[13px] font-medium text-[#fafafa]">Ventas Demo</div>
                    <div class="text-[12px] text-[#a1a1aa]">ventas&#64;demo.cl · Notas de venta</div>
                  </div>
                  <span class="badge">Rol: ventas</span>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <div>
                    <div class="text-[13px] font-medium text-[#fafafa]">Gerencia Demo</div>
                    <div class="text-[12px] text-[#a1a1aa]">gerencia&#64;demo.cl · Supervisión</div>
                  </div>
                  <span class="badge">Rol: gerencia</span>
                </div>
              </div>
            } @else {
              <div class="flex items-center gap-2.5 mb-4">
                <lucide-icon [img]="icons.Settings" [size]="18" [strokeWidth]="1.5"></lucide-icon>
                <h2 class="text-[16px] font-semibold text-[#fafafa]">Ajustes del sistema</h2>
              </div>
              <p class="text-[13px] text-[#a1a1aa] mb-4">
                Parámetros operativos de inventario y facturación de GHOSH.
              </p>
              <div class="space-y-2.5 text-[13px]">
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <span class="text-[#a1a1aa]">Bodega principal</span>
                  <strong class="text-[#fafafa] font-medium">Bodega Central Talca</strong>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <span class="text-[#a1a1aa]">Zona horaria auditable</span>
                  <strong class="text-[#fafafa] font-mono text-[12px]">America/Santiago</strong>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <span class="text-[#a1a1aa]">Tasa de IVA (Lista de precios)</span>
                  <strong class="text-[#fafafa] font-medium">19%</strong>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between">
                  <span class="text-[#a1a1aa]">Política de descuento de lotes</span>
                  <strong class="text-[#fafafa] font-medium">FEFO (First Expired, First Out)</strong>
                </div>
                <div class="p-3 rounded-[8px] bg-[#0a0a0a] border border-[#262626] flex items-center justify-between gap-3">
                  <span class="text-[#a1a1aa]">Modo aplicación móvil (PWA)</span>
                  @if (pwaInstallPrompt()) {
                    <button type="button" class="btn btn-sm btn-primary" (click)="installPwa()">
                      Instalar App
                    </button>
                  } @else {
                    <strong class="text-[#fafafa] font-medium">Stand-alone listo (manifest + iconos)</strong>
                  }
                </div>
              </div>
            }

            <div class="mt-6 flex justify-end">
              <button
                type="button"
                class="btn btn-primary"
                (click)="activeSecondaryModal.set(null)"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      }
    }

    <!-- Modal de confirmación reutilizable -->
    <app-glass-confirm-modal />
  `,
})
export class AppComponent implements OnInit {
  readonly api = inject(GhoshApiService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  readonly currentSection = signal('Catálogo');
  readonly sidebarCollapsed = signal(false);
  readonly mobileDrawerOpen = signal(false);
  readonly headerDropdownOpen = signal(false);
  readonly activeSecondaryModal = signal<'team' | 'settings' | null>(null);
  readonly tabletSimMode = signal(false);
  readonly tabletOrientation = signal<'portrait' | 'landscape'>('portrait');
  readonly pwaInstallPrompt = signal<BeforeInstallPromptEvent | null>(null);

  loginUsername = '';
  loginPassword = '';
  readonly loginError = signal<string | null>(null);

  readonly navItems = [
    { path: '/catalogo', label: 'Catálogo', icon: LayoutGrid },
    { path: '/ventas', label: 'Nota de venta', icon: ReceiptText },
    { path: '/pedidos', label: 'Pedidos', icon: ClipboardList },
    { path: '/notas-venta', label: 'Auditoría de ventas', icon: FileSpreadsheet },
    { path: '/recepcion', label: 'Recepción', icon: PackagePlus },
    { path: '/movimientos', label: 'Movimientos', icon: ArrowUpDown },
    { path: '/demanda', label: 'Demanda y alertas', icon: AlertTriangle },
  ];

  readonly quickTabletNavItems = [
    { path: '/catalogo', shortLabel: 'Catálogo', icon: LayoutGrid },
    { path: '/ventas', shortLabel: 'Venta', icon: ReceiptText },
    { path: '/pedidos', shortLabel: 'Pedidos', icon: ClipboardList },
    { path: '/demanda', shortLabel: 'Alertas', icon: AlertTriangle },
  ];

  readonly icons = {
    AlertTriangle,
    LayoutGrid,
    ReceiptText,
    ClipboardList,
    PackagePlus,
    ArrowUpDown,
    Users,
    Settings,
    LogOut,
    ChevronDown,
    PanelLeft,
    PanelLeftClose,
    Check,
    User,
    Lock,
    X,
  };

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.location.search.includes('tablet=1')) {
      this.tabletSimMode.set(true);
    }

    this.api.checkHealth().subscribe();

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        let route = this.activatedRoute.firstChild;
        while (route?.firstChild) {
          route = route.firstChild;
        }
        const label = route?.snapshot.data['label'];
        if (label) {
          this.currentSection.set(label);
        }
      });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.headerDropdownOpen()) {
      this.headerDropdownOpen.set(false);
    }
  }

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstallPrompt(event: Event): void {
    event.preventDefault();
    this.pwaInstallPrompt.set(event as BeforeInstallPromptEvent);
  }

  @HostListener('window:appinstalled')
  onAppInstalled(): void {
    this.pwaInstallPrompt.set(null);
  }

  async installPwa(): Promise<void> {
    const promptEvent = this.pwaInstallPrompt();
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    this.pwaInstallPrompt.set(null);
  }

  onLoginSubmit(): void {
    this.loginError.set(null);
    const ok = this.auth.login(this.loginUsername, this.loginPassword);
    if (!ok) {
      this.loginError.set('Credenciales inválidas. Usa usuario "admin" y contraseña "admin".');
      return;
    }
    this.loginPassword = '';
    this.api.checkHealth().subscribe();
  }

  onLogout(): void {
    this.mobileDrawerOpen.set(false);
    this.headerDropdownOpen.set(false);
    this.auth.logout();
  }

  toggleSidebar(): void {
    if (this.tabletSimMode() || (typeof window !== 'undefined' && window.innerWidth < 1024)) {
      this.mobileDrawerOpen.update((v) => !v);
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  collapseSidebar(): void {
    if (this.tabletSimMode() || (typeof window !== 'undefined' && window.innerWidth < 1024)) {
      this.mobileDrawerOpen.set(false);
    } else {
      this.sidebarCollapsed.set(true);
    }
  }

  toggleTabletSimMode(): void {
    this.mobileDrawerOpen.set(false);
    this.tabletSimMode.update((v) => !v);
  }

  toggleWorkspaceMenu(): void {
    this.activeSecondaryModal.set('settings');
  }

  toggleHeaderDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.headerDropdownOpen.update((v) => !v);
  }

  refreshHealth(): void {
    this.api.checkHealth().subscribe();
  }
}
