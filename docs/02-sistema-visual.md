# Sistema visual institucional

## Origen y adaptación de UI/UX Pro Max

UI/UX Pro Max recomendó el estilo **Accessible & Ethical**, tipografías Lexend/Source Sans 3, alto contraste, foco de 3–4 px, navegación por teclado, objetivos de 44 px y reducción de movimiento. Se adoptan esos principios.

El patrón sugerido de “Horizontal Scroll Journey” se rechaza porque corresponde a una landing comercial y perjudica una tarea contable recurrente. Se reemplaza por un shell de escritorio con navegación lateral estable y una única pantalla de importación en bloques numerados, coherente con el requerimiento.

## Tokens

- Acento institucional: `#C8043C` (selección y acciones principales, nunca como fondo masivo).
- Acento oscuro: `#97052F`.
- Tinta: `#18212F`; texto secundario: `#4B5565`.
- Fondo de trabajo: `#F5F6F8`; superficies: `#FFFFFF`; borde: `#D8DDE5`.
- Correcto: `#18794E`; advertencia: `#8A5A00`; error: `#B42318`; pendiente: `#667085`.
- Fuente offline: `Segoe UI Variable`, `Segoe UI`, sans-serif. No se depende de Google Fonts ni de internet.
- Escala: 4, 8, 12, 16, 24, 32 px.
- Radios: 4 px en controles, 6 px en paneles, sin “píldoras” decorativas.
- Sombra: solo elevación funcional (`0 1px 3px rgba(16,24,40,.10)`).

## Componentes y densidad

- Controles de 40 px; acciones críticas y targets táctiles de 44 px.
- Tablas: 12 px vertical / 16 px horizontal, encabezado fijo, números tabulares y montos a la derecha.
- Paneles con borde; las tarjetas solo agrupan contenido y no son interactivas por defecto.
- Iconos exclusivamente Bootstrap Icons, tamaño consistente de 18–20 px.
- Transiciones de color de 160 ms; sin escalado ni desplazamiento en hover.

## Estados

- **Loading**: progreso determinado con etapa y cifras; skeleton solo para consultas breves.
- **Empty**: explica por qué no hay información y ofrece una acción pertinente.
- **Error**: mensaje humano junto al origen, resumen enfocable y ruta de recuperación.
- **Success**: conciliación `0.00`, total y reportes; el color nunca es el único indicador.
- **Disabled**: opacidad, cursor y explicación visible; los campos se bloquean durante proceso.

## Accesibilidad

Contraste WCAG AA, foco visible, skip link, HTML semántico, labels asociados, `aria-live` para progreso, orden de tabulación natural, reducción de movimiento y tablas con caption/encabezados. El shell se prueba a 375, 768, 1024 y 1440 px; en ventanas estrechas el sidebar colapsa y las tablas usan scroll horizontal controlado.

