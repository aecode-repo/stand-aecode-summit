# Stand AECODE — AI Construction Summit 2026

Landing estática mobile-first para capturar leads en el stand. El visitante escanea un QR,
se registra, y es derivado al Beacons (Instagram + canal de WhatsApp). Los datos van a un
Google Sheet y disparan un correo personalizado.

## Estructura

```
stand-aecode-summit/
├── index.html          ← la landing
├── styles.css          ← diseño (paleta y tipografía reales de AECODE)
├── app.js              ← lógica del formulario
├── config.js           ← ⚙️ EDITA AQUÍ links, intereses, redirección
├── assets/
│   ├── aecodito.png    ← ⬅️ GUARDA AQUÍ la imagen del Aecodito (ver abajo)
│   ├── logo-summit.avif
│   └── aecode-logo-blanco.png
└── apps-script/
    └── Codigo.gs       ← backend (Google Apps Script)
```

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
- **Premios y stock de la ruleta** → pestaña `Inventario_Ruleta` del Sheet
