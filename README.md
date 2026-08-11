# Stand AECODE — AI Construction Summit 2026

Landing estática mobile-first para capturar leads en el stand. El visitante escanea un QR,
se registra, y es derivado al Beacons (Instagram + canal de WhatsApp). Los datos van a un
Google Sheet.

## 🔴 Flujo v4 — el correo lo dispara el VENDEDOR (no el propio usuario)

1. La persona se registra y **gira la ruleta física**. Se guarda como `PENDIENTE`.
   **Todavía NO recibe correo.**
2. Los vendedores entran al **panel** (`/panel/`) con una contraseña, desde su celular.
   Ven, en tiempo real (refresco cada 5 s), todos los registros en espera.
3. El vendedor abre el registro de esa persona y **marca el premio que ganó en la ruleta**
   (opciones editables). Mientras lo tiene abierto, a los demás vendedores les sale
   “🔒 lo está atendiendo X” y el servidor impide que dos asignen el mismo.
4. **Al confirmar**, recién ahí se envía el correo (ya con el premio) y el lead queda cerrado.

Así el usuario nunca se auto-asigna el premio, y no puede repetir con otro correo.

## Estructura

```
stand-aecode-summit/
├── index.html          ← la landing
├── styles.css          ← diseño (paleta y tipografía reales de AECODE)
├── app.js              ← lógica del formulario
├── config.js           ← ⚙️ EDITA AQUÍ links, intereses, redirección
├── panel/              ← 🆕 PANEL de vendedores (protegido con contraseña)
│   ├── index.html
│   ├── panel.css
│   └── panel.js        ← la URL del Apps Script está aquí arriba (const API)
├── assets/
│   ├── logo-summit.avif
│   └── aecode-logo-blanco.png
└── apps-script/
    ├── Codigo.gs             ← backend público (SIN secretos)
    └── Codigo.WITH-SECRETS.gs ← el que se pega en Apps Script (token GHL + PANEL_KEY)
```

## El panel de vendedores

- URL: `https://stand-aecode-summit.vercel.app/panel/`
- Entran con **su nombre** + la **contraseña** (`PANEL_KEY`, definida en el Apps Script).
- Varios pueden entrar a la vez, cada uno en su celular — todos ven la misma cola.
- Premios editables en la pestaña **`Premios_Panel`** del Sheet (columna `Tipo`: `premio` o `sin`).
- **Cambia la contraseña** en `Codigo.WITH-SECRETS.gs` → `var PANEL_KEY = "..."` antes de desplegar.

## ⬅️ Paso pendiente: la imagen del Aecodito

Guarda la imagen del Aecodito como **`assets/aecodito.png`**.
(Si no está, la landing igual se ve bien — solo no muestra la mascota.)

## Ver el preview localmente (en tu compu)

Con Node ya instalado, desde esta carpeta:

```bash
npx serve .
```

Abre la URL que muestre (ej. `http://localhost:3000`) en el navegador **y en tu celular**
(mismo WiFi, usando la IP que aparece) para probar el mobile.

> Funciona en "modo demo" hasta que conectes el Apps Script — el form valida y muestra la
> pantalla final, pero aún no guarda datos.

## Conectar el backend (Google Sheet + correos)

1. Abre tu Google Sheet → **Extensiones → Apps Script**.
2. Pega `apps-script/Codigo.gs`. Guarda.
3. Ejecuta la función **`setupSheet`** una vez → crea las pestañas `Leads`, `Config_Correo`, `Inventario_Ruleta`.
4. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo (coordinador@aecode.ai)**
   - Con acceso: **Cualquier persona**
5. Copia la URL `/exec` y pégala en `config.js → APPS_SCRIPT_URL`.
6. (Opcional) En `Codigo.gs`, pega el webhook de GHL en `GHL_WEBHOOK_URL` para que el lead
   entre al embudo con la etiqueta `leads summit presencial`.

## Publicar (cuando el preview esté aprobado)

**Netlify (arrastrar y soltar):** entra a app.netlify.com → *Add new site → Deploy manually*
→ arrastra la carpeta `stand-aecode-summit`. Listo, te da una URL.

**O Vercel:** `npx vercel --prod` desde esta carpeta (pide login la primera vez).

Luego generas un **QR** apuntando a esa URL y lo imprimes para el stand.

## Editar sin tocar código

- **Links, intereses, segundos de redirección, cargos** → `config.js`
- **Textos del correo** → pestaña `Config_Correo` del Sheet
- **Premios que marca el vendedor en el panel** → pestaña `Premios_Panel` del Sheet
- **Premios y stock físico de la ruleta** → pestaña `Inventario_Ruleta` del Sheet
- **Contraseña del panel** → `PANEL_KEY` en `Codigo.WITH-SECRETS.gs` (requiere redeploy)
