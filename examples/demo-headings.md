# Historial de demostración

`demo-headings.json` contiene temas de ejemplo para probar coincidencias exactas,
normalización de acentos, subdivisiones y similitudes. No son autoridades validadas.

La carga es manual, mediante el endpoint existente; no requiere desplegar código:

```powershell
node examples/load-demo-headings.mjs https://topicauthority.onrender.com
```

Si Node necesita los certificados del sistema en Windows y soporta esta opción:

```powershell
node --use-system-ca examples/load-demo-headings.mjs https://topicauthority.onrender.com
```

La carga no inventa biblionumbers ni incrementa usos. Omite los temas existentes.
`demo-headings-receipt.json` registra los identificadores que esta carga incorporó;
conservarlo para distinguirlos al retirar los ejemplos. Los datos no llevan una
etiqueta de demostración en la interfaz: su identificación está en este recibo.

Para la presentación, buscar `ciencias de la computacion`, `aprendizaje automatico`,
`quimica`, `fisica cuantica`, `botanica` y
`Modelos de lenguaje (Ciencia de la computación)`.

La API actual no permite borrar entradas. Cuando se retiren los ejemplos, usar el
recibo para eliminar únicamente esas entradas del JSON del servidor, con respaldo
y el proceso detenido para evitar escrituras simultáneas. Conservar cualquier
entrada que entretanto tenga usos bibliográficos reales y no modificar temas
preexistentes. Borrar estos archivos del repositorio no elimina los datos remotos.

En Render sin disco persistente, los ejemplos también pueden perderse al reiniciar
o desplegar el servicio. Este script permite cargarlos nuevamente para otra demo.
