# Q10 Jack API Documentation

**Base URL:** `https://api.q10.com/v1` (presumed)
**API Name:** Q10 Académico (Jack API)
**Authentication:** API Key (header: `Api-Key`)
**Subscription:** Required
**API Version:** v1

---

## Table of Contents

1. [Administrativos](#administrativos)
2. [Años Lectivos](#años-lectivos)
3. [Áreas](#áreas)
4. [Asignaturas](#asignaturas)
5. [Aulas](#aulas)
6. [Aulas Virtuales](#aulas-virtuales)
7. [Barrios](#barrios)
8. [Cargas Académicas](#cargas-académicas)
9. [Codeudores](#codeudores)
10. [Colegios](#colegios)
11. [Comunidad Excel](#comunidad-excel)
12. [Contacto/Oportunidades](#contactooportunidades)
13. [Cursos](#cursos)
14. [Cursos Rotativos](#cursos-rotativos)
15. [Descuentos](#descuentos)
16. [Egresos](#egresos)
17. [Encuestas](#encuestas)
18. [Especialidades](#especialidades)
19. [Estudiantes](#estudiantes)
20. [Evaluaciones](#evaluaciones)
21. [Facturas](#facturas)
22. [Familiares](#familiares)
23. [Grados](#grados)
24. [Horarios](#horarios)
25. [Inasistencias](#inasistencias)
26. [Indicadores](#indicadores)
27. [Inscripciones](#inscripciones)
28. [Instituciones Educativas](#instituciones-educativas)
29. [Jornadas](#jornadas)
30. [Matrículas](#matrículas)
31. [Negocios](#negocios)
32. [Niveles](#niveles)
33. [Otros (Pagos, Impuestos, etc.)](#otros)
34. [Perfiles y Usuarios](#perfiles-y-usuarios)
35. [Pensiones](#pensiones)
36. [Planes de Pago](#planes-de-pago)
37. [Prácticas Laborales](#prácticas-laborales)
38. [Programas](#programas)
39. [Renovación](#renovación)
40. [Sedes](#sedes)

---

## Administrativos

### Obtener administrativos
- **ID:** `obtener-administrativos`
- **Method:** GET
- **URL:** `/administrativos`
- **Description:** Permite obtener el listado de administrativos registrados en la institución

### Obtener detalle de administrativo
- **ID:** `obtener-detalle-administrativo`
- **Method:** GET
- **URL:** `/administrativos/{id}`
- **Description:** Permite obtener el detalle de un administrativo específico

---

## Años Lectivos

### Obtener años lectivos
- **ID:** `obtener-a-os-lectivos-colegio`
- **Method:** GET
- **URL:** `/annoslectivos`
- **Description:** Permite obtener el listado de años lectivos configurados en la institución

### Obtener detalle de año lectivo
- **ID:** `obtener-detalle-a-o-lectivo-colegio`
- **Method:** GET
- **URL:** `/annoslectivos/{id}`
- **Description:** Permite obtener el detalle de un año lectivo específico.

---

## Áreas

### Obtener áreas
- **ID:** `obtener-areas`
- **Method:** GET
- **URL:** `/area?Aplica_promocion={Aplica_promocion}`
- **Description:** Sirve para obtener todas las áreas

### Obtener detalle área
- **ID:** `obtener-detalle-area`
- **Method:** GET
- **URL:** `/area/{Codigo_area}`
- **Description:** Obtiene el área indicada

### Registrar área
- **ID:** `ingresar-area`
- **Method:** POST
- **URL:** `/area`
- **Description:** Permite crear un área en la plataforma de la institución

---

## Asignaturas

### Obtener asignaturas
- **ID:** `obtener-asignaturas`
- **Method:** GET
- **URL:** `/asignaturas`
- **Description:** Obtener listado de asignaturas

### Obtener asignaturas áreas
- **ID:** `obtener-asignaturas-areas`
- **Method:** GET
- **URL:** `/asignaturasareas?Estado={Estado}`
- **Description:** Devuelve toda la información de las asignaturas con el estado especificado.

### Obtener detalle de asignatura
- **ID:** `obtener-detalle-asignatura`
- **Method:** GET
- **URL:** `/asignaturas/{id}`
- **Description:** Permite obtener el detalle de una asignatura especifica

### Obtener detalle de asignatura área
- **ID:** `obtener-detalle-de-asignatura-area`
- **Method:** GET
- **URL:** `/asignaturasareas/{id}`
- **Description:** Permite obtener el detalle de una asignatura especifica

### Registrar asignatura área
- **ID:** `registrar-asignatura-area`
- **Method:** POST
- **URL:** `/asignaturasareas`
- **Description:** Permite crear una asignatura en un colegio

---

## Aulas

### Obtener aulas
- **ID:** `obtener-aulas`
- **Method:** GET
- **URL:** `/aulas`
- **Description:** Obtener listado de aulas

### Obtener detalle aula
- **ID:** `obtener-detalle-aula`
- **Method:** GET
- **URL:** `/aulas/{id}`
- **Description:** Obtiene el detalle de un aula

---

## Aulas Virtuales

### Obtener aulas virtuales
- **ID:** `obtener-aulas-virtuales`
- **Method:** GET
- **URL:** `/aulasvirtuales`
- **Description:** Obtiene una lista de aulas virtuales

---

## Barrios

### Obtener barrios
- **ID:** `obtener-barrios`
- **Method:** GET
- **URL:** `/barrios?Codigo_municipio={Codigo_municipio}`
- **Description:** Obtener barrios

---

## Cargas Académicas

### Obtener cargas académicas
- **ID:** `obtener-cargas-academicas`
- **Method:** GET
- **URL:** `/cargasacademicas?Identificacion_estudiante={Identificacion_estudiante}&Programa={Programa}`
- **Description:** Permite obtener el listado de cargas académicas de un estudiante en programas de tipo cuantitativo, modular o pedagógico.

### Obtener cargas académicas competencias
- **ID:** `obtener-cargas-acad-micas-competencias`
- **Method:** GET
- **URL:** `/cargasacademicas/competencias?Identificacion_estudiante={Identificacion_estudiante}&Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener el listado de cargas académicas de un estudiante en programas de tipo competencias.

---

## Codeudores

### Obtener codeudores
- **ID:** `obtener-codeudores`
- **Method:** GET
- **URL:** `/codeudores`
- **Description:** Obtiene la lista de codeudores

### Obtener detalle codeudor
- **ID:** `obtener-detalle-codeudor`
- **Method:** GET
- **URL:** `/codeudores/{Id}`
- **Description:** Obtiene el detalle de un codeudor

---

## Colegios

### Obtener grados colegios
- **ID:** `obtener-grados-colegios`
- **Method:** GET
- **URL:** `/grados`
- **Description:** Permite obtener los grados configurados en una institución de tipo colegio.

### Obtener detalle grado colegios
- **ID:** `obtener-detalle-grado-colegios`
- **Method:** GET
- **URL:** `/grados/{id}`
- **Description:** Permite obtener el detalle de un grado según el id indicado

### Registrar grados colegio
- **ID:** `registrar-grados-colegio`
- **Method:** POST
- **URL:** `/grados`
- **Description:** Permite registrar un grado

### Obtener grupos colegios
- **ID:** `obtener-grupos-colegios`
- **Method:** GET
- **URL:** `/gruposcolegios`
- **Description:** Obtener una lista de grupos de colegios.

### Obtener detalle grupo colegio
- **ID:** `obtener-detalle-grupo-colegio`
- **Method:** GET
- **URL:** `/gruposcolegios/{Consecutivo_grupo}`
- **Description:** Obtener detalle grupo colegio

### Crear grupo colegio
- **ID:** `crear-grupo-colegio`
- **Method:** POST
- **URL:** `/gruposcolegios`
- **Description:** Permite crear un grupo en un colegio

### Obtener matriculas colegios
- **ID:** `obtener-matriculas-colegios`
- **Method:** GET
- **URL:** `/matriculas-colegios?Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}`
- **Description:** Obtener una lista de matriculas de colegios.

### Matricular estudiante colegio
- **ID:** `matricular-estudiante-colegio`
- **Method:** POST
- **URL:** `/matriculas-colegios`
- **Description:** Matricular estudiante colegio

### Obtener detalle negocio colegio
- **ID:** `obtener-detalle-negocio-colegio`
- **Method:** GET
- **URL:** `/negocios/{Consecutivo_negocio}/colegio`
- **Description:** Permite obtener un negocio de colegio por medio de su consecutivo

### Obtener detalle oportunidad colegio
- **ID:** `obtener-detalle-oportunidad-colegio`
- **Method:** GET
- **URL:** `/oportunidades/{id}/colegio`
- **Description:** Obtener detalle oportunidad colegio

### Obtener horarios de Colegios
- **ID:** `obtener-horarios-de-colegios`
- **Method:** GET
- **URL:** `/horarios/colegios?Consecutivo_grado={Consecutivo_grado}&Codigo_asignatura={Codigo_asignatura}&Consecutivo_anio_lectivo={Consecutivo_anio_lectivo}&Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtiene los horarios en colegios

### Obtener detalle horario Colegio
- **ID:** `obtener-detalle-horario-colegio`
- **Method:** GET
- **URL:** `/horarios/{id}/colegios/`
- **Description:** Obtiene el detalle del horario de un colegio.

### Registrar estudiante colegio
- **ID:** `registrar-estudiante-colegio`
- **Method:** POST
- **URL:** `/estudiantes/colegio`
- **Description:** Ingresar registro de estudiante en colegios.

### Obtener detalle estudiante - Colegios
- **ID:** `obtener-detalle-de-estudiante`
- **Method:** GET
- **URL:** `/estudiantes/colegios/{id}`
- **Description:** Permite obtener el detalle de un estudiante en Colegios.

### Obtener historial académico colegios
- **ID:** `obtener-historial-academico-colegios`
- **Method:** GET
- **URL:** `/estudiantes/{id}/historial-academico`
- **Description:** Permite obtener la información general del historial académico de un estudiante en colegios.

### Obtener encuestas colegio
- **ID:** `obtener-detalle-encuesta-colegio`
- **Method:** GET
- **URL:** `/colegios/encuestas/{id}`
- **Description:** Permite obtener el detalle de una encuesta para colegios.

### Obtener preinscripciones Colegios
- **ID:** `api-preinscripciones-colegios`
- **Method:** GET
- **URL:** `/colegios/preinscripciones?Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}`
- **Description:** Obtener lista preinscripciones Colegios

### Registrar inscripción grado
- **ID:** `registrar-inscripcion-grado`
- **Method:** POST
- **URL:** `/inscripciones/colegios`
- **Description:** Realiza la preinscripción del estudiante a un grado.

### Obtener inscripciones colegio
- **ID:** `obtener-inscripciones-colegio`
- **Method:** GET
- **URL:** `/inscripciones/colegios`
- **Description:** Permite obtener inscripciones en colegios

### Obtener detalle inscripción colegios
- **ID:** `obtener-detalle-inscripcion-colegios`
- **Method:** GET
- **URL:** `/inscripciones/colegios/{id}`
- **Description:** Obtener detalle inscripción colegios

### Obtener detalle preinscripción colegios
- **ID:** `obtener-detalle-preinscripci-n-colegios`
- **Method:** GET
- **URL:** `/colegios/preinscripciones/{Consecutivo_preinscripcion}`
- **Description:** Obtener detalle preinscripción colegios

### Crear escala nacional
- **ID:** `crear-escala-nacional`
- **Method:** POST
- **URL:** `/escalasnacionales`
- **Description:** Permite crear una escala nacional en un colegio

### Obtener escalas nacionales
- **ID:** `obtener-escalas-nacionales`
- **Method:** GET
- **URL:** `/escalasnacionales`
- **Description:** Obtiene las escalas nacionales del año lectivo

### Crear planes académicos - Colegios
- **ID:** `crear-planes-acad-micos-colegios`
- **Method:** POST
- **URL:** `/planes-academicos`
- **Description:** Permite crear un plan académico a un grupo en colegios.

### Obtener planes académicos - Colegios
- **ID:** `obtener-planes-acad-micos-colegios`
- **Method:** GET
- **URL:** `/planes-academicos`
- **Description:** Permite obtener los planes académicos de colegios, por grupo o área.

### Obtener detalle plan académico - Colegios
- **ID:** `obtener-detalle-plan-acad-mico-colegios`
- **Method:** GET
- **URL:** `/planes-academicos/{id}`
- **Description:** Permite obtener el detalle de un plan académico en colegios

### Ganar negocio colegios
- **ID:** `ganar-negocio-colegios`
- **Method:** PUT
- **URL:** `/negocios/estado/ganar/colegio`
- **Description:** Permite ganar negocios en colegios

### Registrar negocio colegio
- **ID:** `registrar-negocio-colegio`
- **Method:** POST
- **URL:** `/negocios/colegio`
- **Description:** Registrar negocio (Colegio)

### POST - Renovar matrícula colegios
- **ID:** `renovar-matr-cula-colegios`
- **Method:** POST
- **URL:** `/renovacion/colegio`
- **Description:** Permite realizar la renovación de la matrícula de un estudiante en colegios.

### Promover anticipadamente estudiante colegios
- **ID:** `promover-anticipadamente-estudiante-colegios`
- **Method:** POST
- **URL:** `/colegios/promocion-anticipada`
- **Description:** Permite realizar la promoción anticipada de un estudiante en colegios.

### Obtener estudiantes colegio
- **ID:** `obtener-estudiantes-colegio`
- **Method:** GET
- **URL:** `/estudiantes/colegios?Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}&Consecutivo_sede_jornada={Consecutivo_sede_jornada}&Consecutivo_grado={Consecutivo_grado}`
- **Description:** Obtener listado de estudiantes en colegios

### Obtener condiciones de matrícula
- **ID:** `obtener-condiciones-de-matricula`
- **Method:** GET
- **URL:** `/condicionesMatricula?Estado={Estado}`
- **Description:** Permite obtener el listado de condiciones de matrícula configuradas en la institución

---

## Comunidad Excel

### Obtener estudiante comunidad Excel
- **ID:** `obtener-estudiante-comunidad-excel`
- **Method:** GET
- **URL:** `/comunidad-excel/estudiantes?Fecha_inicio_matricula={Fecha_inicio_matricula}&Fecha_fin_matricula={Fecha_fin_matricula}&Estado={Estado}&Incluir_info_adicional={Incluir_info_adicional}&Incluir_info_matricula={Incluir_info_matricula}&Incluir_info_academica={Incluir_info_academica}&Incluir_info_laboral={Incluir_info_laboral}&Incluir_preguntas_personalizadas={Incluir_preguntas_personalizadas}&Incluir_info_familiares={Incluir_info_familiares}`
- **Description:** Permite obtener la información de los estudiantes comunidad Excel ETDH

### Obtener estudiante colegio comunidad Excel
- **ID:** `obtener-estudiante-colegio-comunidad-excel`
- **Method:** GET
- **URL:** `/comunidad-excel/estudiantes/colegio?Incluir_info_matricula={Incluir_info_matricula}&Incluir_info_academica={Incluir_info_academica}&Incluir_info_laboral={Incluir_info_laboral}&Incluir_preguntas_personalizadas={Incluir_preguntas_personalizadas}&Incluir_info_familiares={Incluir_info_familiares}&Incluir_info_adicional_simat={Incluir_info_adicional_simat}&Codigo_sede={Codigo_sede}&Codigo_grado={Codigo_grado}&Fecha_inicio_matricula={Fecha_inicio_matricula}&Fecha_fin_matricula={Fecha_fin_matricula}&Estado={Estado}`
- **Description:** Obtener estudiante colegio comunidad Excel

### Obtener estudiantes comunidad Excel Perú
- **ID:** `obtener-estudiantes-comunidad-excel-peru`
- **Method:** GET
- **URL:** `/comunidad-excel/estudiantes/peru?Fecha_inicio_matricula={Fecha_inicio_matricula}&Fecha_fin_matricula={Fecha_fin_matricula}&Estado={Estado}&Incluir_info_matricula={Incluir_info_matricula}&Incluir_info_academica={Incluir_info_academica}&Incluir_info_laboral={Incluir_info_laboral}&Incluir_preguntas_personalizadas={Incluir_preguntas_personalizadas}&Incluir_info_familiares={Incluir_info_familiares}`
- **Description:** Permite obtener la información de los estudiantes comunidad Excel Perú

---

## Contacto/Oportunidades

### Obtener contactos
- **ID:** `obtener-contactos`
- **Method:** GET
- **URL:** `/contactos`
- **Description:** Permite obtener las contactos creados en las oportunidades.

### Registrar contacto oportunidad
- **ID:** `registrar-contacto-oportunidad`
- **Method:** POST
- **URL:** `/contactos`
- **Description:** Registrar contacto oportunidad

### Obtener actividades
- **ID:** `obtener-actividades`
- **Method:** GET
- **URL:** `/actividades`
- **Description:** Permite obtener actividades registradas a oportunidades.

### Registrar actividad
- **ID:** `registrar-actividad`
- **Method:** POST
- **URL:** `/actividades`
- **Description:** Permite crear una actividad en un negocio de una oportunidad.

### Obtener oportunidades
- **ID:** `obtener-oportunidades`
- **Method:** GET
- **URL:** `/oportunidades?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtener oportunidades

### Obtener oportunidades colegio
- **ID:** `obtener-oportunidades-colegio`
- **Method:** GET
- **URL:** `/oportunidades/colegio?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Permite obtener las oportunidades por medio del filtro de rango de fechas e identificación del asesor

### Obtener detalle oportunidad
- **ID:** `obtener-detalle-oportunidad`
- **Method:** GET
- **URL:** `/oportunidades/{Consecutivo_oportunidad}`
- **Description:** Permite obtener una oportunidad por medio de su consecutivo

### Registrar oportunidad
- **ID:** `registrar-oportunidad`
- **Method:** POST
- **URL:** `/oportunidades`
- **Description:** Permite registrar oportunidades

### Asignar asesor a oportunidad
- **ID:** `asignar-asesor-a-oportunidad`
- **Method:** PATCH
- **URL:** `/oportunidades/{Consecutivo_oportunidad}/asesor`
- **Description:** Permite asignar un asesor a una oportunidad

### Archivar oportunidad
- **ID:** `archivar-oportunidad`
- **Method:** PUT
- **URL:** `/oportunidades/archivar/{Consecutivo_oportunidad}`
- **Description:** Archivar oportunidad

### Desarchivar oportunidad
- **ID:** `desarchivar-oportunidad`
- **Method:** PUT
- **URL:** `/oportunidades/desarchivar/{Consecutivo_oportunidad}`
- **Description:** Desarchivar oportunidad

### Obtener estados de negocio
- **ID:** `obtener-estados-de-negocio`
- **Method:** GET
- **URL:** `/flujonegocios?Estado={Estado}`
- **Description:** Obtiene los estados de negocio de la institución

### Actualizar estado de negocio
- **ID:** `actualizar-estado-de-negocio`
- **Method:** PATCH
- **URL:** `/negocios/estado`
- **Description:** Permite actualizar el estado de un negocio, considerando que no se debe permitir establecer en estado perdido o ganado

### Ganar negocio ETDH
- **ID:** `ganar-negocio-etdh`
- **Method:** PUT
- **URL:** `/negocios/estado/ganar`
- **Description:** Permite ganar negocios en ETDH y Superior

### Perder negocio oportunidad
- **ID:** `perder-negocio-oportunidad`
- **Method:** PUT
- **URL:** `/negocios/estado/perder`
- **Description:** Permite establecer en estado perdido los negocios

### Establecer negocio favorito
- **ID:** `establecer-negocio-favorito`
- **Method:** PUT
- **URL:** `/negocios/favorito/{id}`
- **Description:** Establecer negocio favorito

### Obtener detalle negocio
- **ID:** `obtener-detalle-negocio`
- **Method:** GET
- **URL:** `/negocios/{Consecutivo_negocio}`
- **Description:** Permite obtener un negocio de ETDH y Superior por medio de su consecutivo

### Obtener negocios
- **ID:** `obtener-negocios`
- **Method:** GET
- **URL:** `/negocios`
- **Description:** Permite obtener los negocios

### Obtener negocios colegio
- **ID:** `obtener-negocios-colegio`
- **Method:** GET
- **URL:** `/negocios/colegio`
- **Description:** Permite obtener los negocios por medio de su estado de negocio.

### Registrar negocio
- **ID:** `registrar-negocio`
- **Method:** POST
- **URL:** `/negocios`
- **Description:** Registrar negocio (ETDH y Educación superior)

### Obtener empresas
- **ID:** `obtener-empresas`
- **Method:** GET
- **URL:** `/empresas?Estado={Estado}`
- **Description:** Permite obtener las empresas según su estado.

### Obtener productos
- **ID:** `obtener-productos`
- **Method:** GET
- **URL:** `/productos?Estado={Estado}`
- **Description:** Obtener listado de productos

### Obtener detalle producto
- **ID:** `obtener-detalle-producto`
- **Method:** GET
- **URL:** `/productos/{id}`
- **Description:** Obtiene el detalle de un producto

### Registrar producto
- **ID:** `registrar-producto`
- **Method:** POST
- **URL:** `/productos`
- **Description:** Permite registrar un producto.

### Obtener productos Perú
- **ID:** `obtener-productos-peru`
- **Method:** GET
- **URL:** `/productos/peru`
- **Description:** Permite obtener los productos de las instituciones de Perú

### Registrar producto Perú
- **ID:** `registrar-producto-peru`
- **Method:** POST
- **URL:** `/productos/peru`
- **Description:** Permite registrar un producto para instituciones de Perú.

### Crear campo personalizado
- **ID:** `crear-campo-personalizado-modulo-crm`
- **Method:** POST
- **URL:** `/oportunidad/campospersonalizados`
- **Description:** Permite crear un campo personalizado en el módulo CRM

### Obtener campos personalizados
- **ID:** `obtener-campos-personalizados-crm`
- **Method:** GET
- **URL:** `/oportunidad/campospersonalizados?Estado={Estado}`
- **Description:** Permite obtener los campos personalizados del módulo CRM

---

## Cursos

### Obtener cursos
- **ID:** `obtener-cursos`
- **Method:** GET
- **URL:** `/cursos`
- **Description:** Obtener listado de cursos para el modelo de evaluación cuantitativo

### Obtener detalle curso
- **ID:** `obtener-detalle-curso`
- **Method:** GET
- **URL:** `/cursos/{id}`
- **Description:** Obtener el detalle de un curso para el modelo de evaluación cuantitativo

### Obtener cursos competencias
- **ID:** `obtener-cursos-competencias`
- **Method:** GET
- **URL:** `/cursos-competencias`
- **Description:** Obtener listado de cursos para el modelo de evaluación competencias

### Obtener detalle curso competencias
- **ID:** `obtener-detalle-curso-competencias`
- **Method:** GET
- **URL:** `/cursos-competencias/{id}`
- **Description:** Obtener el detalle de un curso para el modelo de evaluación por competencias

### Obtener el detalle del horario
- **ID:** `obtener-el-detalle-del-horario`
- **Method:** GET
- **URL:** `/horarios/cursos/{id}`
- **Description:** Obtiene el detalle del horario

### Obtener horarios cursos
- **ID:** `obtener-horarios-cursos`
- **Method:** GET
- **URL:** `/horarios/cursos?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}&Incluir_cursos_archivados={Incluir_cursos_archivados}`
- **Description:** Obtiene los horarios de los cursos

### Obtener horarios competencias
- **ID:** `obtener-horarios-competencias`
- **Method:** GET
- **URL:** `/horarios/competencias?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtener listado de horarios para el modelo de evaluación competencias

### Obtener detalle horario competencias
- **ID:** `obtener-detalle-horario-competencias`
- **Method:** GET
- **URL:** `/horarios/{id}/competencias`
- **Description:** Obtener el detalle de un horario para el modelo de evaluación por competencias

### Obtener horarios asignaturas individuales
- **ID:** `obtener-horarios-asignaturas-individuales`
- **Method:** GET
- **URL:** `/horarios/asignaturas/individuales?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtener horarios asignaturas individuales

### Obtener detalle horario asignatura individual
- **ID:** `obtener-detalle-horario-asignatura-individual`
- **Method:** GET
- **URL:** `/horarios/asignaturas/individuales/{Id}`
- **Description:** Obtiene el detalle de un horario de asignatura individual

---

## Cursos Rotativos

### Obtener cursos rotativos
- **ID:** `obtener-cursos-rotativos`
- **Method:** GET
- **URL:** `/cursos-rotativos`
- **Description:** Obtener una lista de cursos rotativos

### Obtener detalle curso rotativo
- **ID:** `obtener-detalle-curso-rotativo`
- **Method:** GET
- **URL:** `/cursos-rotativos/{Consecutivo_curso_rotativo}`
- **Description:** Obtener detalle curso rotativo

### Crear curso rotativo
- **ID:** `crear-curso-rotativo`
- **Method:** POST
- **URL:** `/cursos-rotativos`
- **Description:** Permite crear un curso rotativo

### Obtener horarios cursos rotativos
- **ID:** `obtener-horarios-cursos-rotativos`
- **Method:** GET
- **URL:** `/horarios/cursos-rotativos?Consecutivo_anio_lectivo={Consecutivo_anio_lectivo}`
- **Description:** Permite obtener los horarios de los cursos rotativos para instituciones del modelo académico de colegio

---

## Descuentos

### Obtener descuentos
- **ID:** `obtener-descuentos`
- **Method:** GET
- **URL:** `/descuentos`
- **Description:** Obtener listado de descuentos

### Ingresar descuentos institucionales
- **ID:** `ingresar-descuentos-institucionales`
- **Method:** POST
- **URL:** `/descuentos-institucionales`
- **Description:** Ingresar un descuento institucional por estudiante

---

## Egresos

### Obtener egresos
- **ID:** `obtener-egresos`
- **Method:** GET
- **URL:** `/egresos`
- **Description:** Permite obtener una lista de egresos.

### Obtener detalle de egreso
- **ID:** `obtener-detalle-de-egreso`
- **Method:** GET
- **URL:** `/egresos/{id}`
- **Description:** Permite obtener el detalle de un egreso.

### Registrar egreso
- **ID:** `registrar-egreso`
- **Method:** POST
- **URL:** `/egresos`
- **Description:** Permite registrar un egreso.

---

## Encuestas

### Obtener encuestas
- **ID:** `obtener-encuestas`
- **Method:** GET
- **URL:** `/encuestas?Estado={Estado}&Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Permite obtener el listado de encuestas de la institución.

### Obtener detalle encuesta
- **ID:** `obtener-detalle-encuesta`
- **Method:** GET
- **URL:** `/encuestas/{id}`
- **Description:** Permite obtener el detalle de una encuesta.

### Obtener respuestas encuestas
- **ID:** `obtener-respuestas-encuestas`
- **Method:** GET
- **URL:** `/encuestas/{id}/respuestas`
- **Description:** Permite obtener las respuestas recibidas para una encuesta específica.

---

## Especialidades

### Obtener especialidades
- **ID:** `obtener-especialidades`
- **Method:** GET
- **URL:** `/especialidades?Estado_especialidad={Estado_especialidad}`
- **Description:** Obtiene las especialidades

### Obtener detalle especialidad
- **ID:** `obtener-detalle-especialidad`
- **Method:** GET
- **URL:** `/especialidades/{id}`
- **Description:** Permite obtener el detalle de una especialidad especifica

---

## Estudiantes

### Obtener estudiantes
- **ID:** `obtener-estudiantes`
- **Method:** GET
- **URL:** `/estudiantes?Periodo={Periodo}`
- **Description:** Obtener listado de estudiantes

### Obtener detalle estudiante
- **ID:** `obtener-detalle-estudiante`
- **Method:** GET
- **URL:** `/estudiantes/{id}`
- **Description:** Obtiene el detalle de un estudiante

### Registrar un estudiante
- **ID:** `registrar-un-estudiante`
- **Method:** POST
- **URL:** `/estudiantes`
- **Description:** Registra un estudiante

### Obtener estudiantes cancelados
- **ID:** `obtener-estudiantes-cancelados`
- **Method:** GET
- **URL:** `/matriculas-canceladas?Consecutivo_periodo={Consecutivo_periodo}&Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener los estudiantes cancelados de una institución según los filtros ingresados.

### Obtener estudiantes egresados
- **ID:** `obtener-estudiantes-egresados`
- **Method:** GET
- **URL:** `/egresados`
- **Description:** Permite obtener los estudiantes egresados de una institución según los filtros.

### Obtener estudiantes graduados
- **ID:** `obtener-estudiantes-graduados`
- **Method:** GET
- **URL:** `/graduados`
- **Description:** Permite obtener los estudiantes graduados de una institución según los filtros.

### Establecer estudiante cancelado
- **ID:** `establecer-estudiante-cancelado`
- **Method:** POST
- **URL:** `/matriculas-canceladas`
- **Description:** Permite establecer como cancelado un estudiante a un programa

### Establecer estudiante egresado
- **ID:** `establecer-estudiante-egresado`
- **Method:** POST
- **URL:** `/egresados`
- **Description:** Permite establecer como egresado un estudiante a un programa

### Establecer estudiante graduado
- **ID:** `establecer-estudiante-graduado`
- **Method:** POST
- **URL:** `/graduados`
- **Description:** Permite establecer como graduado un estudiante a un programa

### Obtener el estado de cuenta estudiantes
- **ID:** `obtener-el-estado-de-cuenta-estudiantes`
- **Method:** GET
- **URL:** `/estadocuentaestudiantes`
- **Description:** Permite obtener el estado de cuenta de un estudiante

---

## Evaluaciones

### Obtener evaluaciones
- **ID:** `obtener-evaluaciones`
- **Method:** GET
- **URL:** `/evaluaciones?Programa={Programa}`
- **Description:** Obtener listado de las evaluaciones a las asignaturas de un estudiante para determinado programa

### Obtener evaluaciones cuantitativo
- **ID:** `obtener-evaluaciones-cuantitativo`
- **Method:** GET
- **URL:** `/evaluaciones/cuantitativo/notas`
- **Description:** Permite obtener las notas del modelo evaluativo cuantitativo

### Registrar notas - Cuantitativo
- **ID:** `registrar-notas-cuantitativo`
- **Method:** POST
- **URL:** `/evaluaciones/cuantitativo/notas`
- **Description:** Permite registrar notas a varios parámetros de un estudiante, de un curso cuantitativo.

### Obtener evaluaciones competencias
- **ID:** `obtener-evaluaciones-competencias`
- **Method:** GET
- **URL:** `/evaluaciones/competencias/notas`
- **Description:** Permite obtener las evaluaciones del modelo competencias

### Obtener evaluaciones modular
- **ID:** `obtener-evaluaciones-modular`
- **Method:** GET
- **URL:** `/evaluaciones/modular/notas`
- **Description:** Permite obtener las notas del modelo evaluativo modular

### Obtener parámetros
- **ID:** `obtener-parametros`
- **Method:** GET
- **URL:** `/parametrosevaluacion?Consecutivo_curso={Consecutivo_curso}`
- **Description:** Obtiene los parámetros y sub parámetros de evaluación configurados para un curso específico, incluyendo sus porcentajes y nombres asociados.

---

## Facturas

### Obtener facturas
- **ID:** `obtener-facturas`
- **Method:** GET
- **URL:** `/facturas`
- **Description:** Permite obtener todas las facturas que tiene la institución.

### Obtener detalle factura
- **ID:** `obtener-detalle-factura`
- **Method:** GET
- **URL:** `/facturas{Consecutivo_factura}`
- **Description:** Permite obtener el detalle de las facturas registradas.

### Registrar factura
- **ID:** `registrar-factura`
- **Method:** POST
- **URL:** `/facturas`
- **Description:** Permite registrar una factura

### Anular factura
- **ID:** `anular-factura`
- **Method:** POST
- **URL:** `/facturas/anular`
- **Description:** Permite anular cualquier factura seleccionada.

### Obtener facturas creditos
- **ID:** `obtener-facturas-creditos`
- **Method:** GET
- **URL:** `/facturas/creditos`
- **Description:** Permite obtener las facturas relacionadas a los créditos.

### Obtener detalle factura credito
- **ID:** `obtener-detalle-factura-credito`
- **Method:** GET
- **URL:** `/facturas/creditos/{Consecutivo_factura}`
- **Description:** Permite obtener el detalle de un crédito y factura relacionados

### Obtener notas creditos factura
- **ID:** `obtener-notas-creditos-facturas`
- **Method:** GET
- **URL:** `/facturas/notascredito`
- **Description:** Permite obtener las notas crédito creadas en facturas

### Obtener detalle nota credito factura
- **ID:** `obtener-detalle-nota-credito-factura`
- **Method:** GET
- **URL:** `/facturas/notascredito/{Consecutivo_nota_credito}`
- **Description:** Permite obtener el detalle de una nota crédito de factura

### Registrar nota crédito factura
- **ID:** `registrar-nota-cr-dito-factura`
- **Method:** POST
- **URL:** `/facturas/notascredito`
- **Description:** Permite registrar y relacionar una nota crédito a una factura

### Anular nota crédito factura
- **ID:** `anular-nota-cr-dito-factura`
- **Method:** POST
- **URL:** `/facturas/anularNotaCredito`
- **Description:** Permite anular una nota crédito de facturas

### Relacionar nota credito factura
- **ID:** `relacionar-nota-credito-factura`
- **Method:** POST
- **URL:** `/facturas/notascredito/relacionar`
- **Description:** Permite relacionar una nota crédito a una factura.

### Retirar nota credito factura
- **ID:** `retirar-nota-credito-factura`
- **Method:** POST
- **URL:** `/facturas/notascredito/retirar`
- **Description:** Permite retirar una nota crédito relacionada a una factura.

### Registrar retencion a factura
- **ID:** `registrar-retencion-a-factura`
- **Method:** POST
- **URL:** `/facturas/retencion/registrar`
- **Description:** Permite relacionar una retención a una factura.

### Retirar retencion factura
- **ID:** `retirar-retencion-factura`
- **Method:** POST
- **URL:** `/facturas/retirarRetencion`
- **Description:** Permite retirar una retención que se encuentre relacionada a una factura.

### Obtener pagos facturas
- **ID:** `obtener-pagos-facturas`
- **Method:** GET
- **URL:** `/pagos/facturas`
- **Description:** Permite obtener todos los pagos de todas las facturas de la institución.

### Registrar pago a facturas
- **ID:** `registrar-pago-a-facturas`
- **Method:** POST
- **URL:** `/pagos/facturas`
- **Description:** Permite registrar un pago a una o más facturas.

### Obtener detalle pago factura
- **ID:** `obtener-detalle-pago-factura`
- **Method:** GET
- **URL:** `/pagos/{id}/facturas`
- **Description:** Permite obtener el detalle de un pago a una o más facturas.

---

## Familiares

### Obtener familiares
- **ID:** `obtener-familiares`
- **Method:** GET
- **URL:** `/familiares`
- **Description:** Obtener listado de familiares

### Obtener detalle familiar
- **ID:** `obtener-detalle-familiar`
- **Method:** GET
- **URL:** `/familiares/{id}`
- **Description:** Obtiene el detalle de un familiar

### Registrar familiar
- **ID:** `registrar-familiar`
- **Method:** POST
- **URL:** `/familiares`
- **Description:** Permite registrar un familiar

### Asignar familiar a estudiantes
- **ID:** `asignar-familiar-estudiantes`
- **Method:** POST
- **URL:** `/familiares/relacionar-estudiantes`
- **Description:** Asigna a múltiples estudiantes un familiar o codeudor

---

## Grados

### Obtener grados periodos
- **ID:** `obtener-grados-periodos`
- **Method:** GET
- **URL:** `/grados/grados-periodos?Consecutivo_grado={Consecutivo_grado}&Consecutivo_anio_lectivo={Consecutivo_anio_lectivo}`
- **Description:** Obtener grados periodos

### Crear grados periodos
- **ID:** `crear-grados-periodos`
- **Method:** POST
- **URL:** `/grados/grados-periodos`
- **Description:** Permite crear periodos a un grado en un año lectivo.

---

## Horarios

### Obtener horarios cursos rotativos
- **ID:** `obtener-horarios-cursos-rotativos`
- **Method:** GET
- **URL:** `/horarios/cursos-rotativos?Consecutivo_anio_lectivo={Consecutivo_anio_lectivo}`
- **Description:** Permite obtener los horarios de los cursos rotativos para instituciones del modelo académico de colegio

---

## Inasistencias

### Obtener inasistencias
- **ID:** `obtener-inasistencias`
- **Method:** GET
- **URL:** `/inasistencias?Fecha_inicio_inasistencia={Fecha_inicio_inasistencia}&Fecha_fin_inasistencia={Fecha_fin_inasistencia}`
- **Description:** Obtener inasistencias

---

## Indicadores

### Obtener Indicadores
- **ID:** `obtener-indicadores`
- **Method:** GET
- **URL:** `/indicadores?Consecutivo_grado={Consecutivo_grado}&Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}`
- **Description:** Permite obtener los indicadores

### Obtener Detalle Indicador
- **ID:** `obtener-detalle-indicador`
- **Method:** GET
- **URL:** `/indicadores/{Consecutivo_indicador}`
- **Description:** Permite obtener el detalle de un indicador en específico

### Crear Indicador
- **ID:** `crear-indicador`
- **Method:** POST
- **URL:** `/indicadores`
- **Description:** Permite crear indicadores

### Obtener Tipos De Indicadores
- **ID:** `obtener-tipos-de-indicadores`
- **Method:** GET
- **URL:** `/tipos-indicadores`
- **Description:** Obtener una lista de tipos de indicadores

---

## Inscripciones

### Obtener inscripciones
- **ID:** `obtener-inscripciones`
- **Method:** GET
- **URL:** `/inscripciones`
- **Description:** Permite obtener la información de los estudiantes inscritos (no matriculados) en un programa.

### Obtener preinscripciones
- **ID:** `obtener-preinscripciones`
- **Method:** GET
- **URL:** `/preinscripciones?Periodo={Periodo}`
- **Description:** Obtiene las preinscripciones

### Obtener detalle preinscripcion
- **ID:** `obtener-detalle-preinscripcion`
- **Method:** GET
- **URL:** `/preinscripciones/{id}`
- **Description:** Obtiene el detalle de una preinscripción

### Ingresar preinscripciones
- **ID:** `ingresar-preinscripciones`
- **Method:** POST
- **URL:** `/preinscripciones`
- **Description:** Ingresa las preinscripciones

### Registrar inscripción estudiante a programa
- **ID:** `registrar-inscripci-n-estudiante-a-programa`
- **Method:** POST
- **URL:** `/inscripciones`
- **Description:** Permite registrar la inscripción de un estudiante en un programa en específico.

---

## Instituciones Educativas

### Obtener instituciones educativas
- **ID:** `obtener-instituciones-educativas`
- **Method:** GET
- **URL:** `/instituciones-educativas`
- **Description:** Obtener una lista de instituciones educativas

---

## Journadas

### Obtener jornadas
- **ID:** `obtener-jornadas`
- **Method:** GET
- **URL:** `/jornadas`
- **Description:** Obtener Listado de Journadas

### Obtener detalle jornada
- **ID:** `obtener-detalle-jornada`
- **Method:** GET
- **URL:** `/jornadas/{id}`
- **Description:** Obtiene el detalle de una jornada

---

## Matrículas

### Matricular estudiante al programa
- **ID:** `matricular-estudiante-al-programa`
- **Method:** POST
- **URL:** `/matriculasProgramas`
- **Description:** Permite matricular al estudiante a un programa

### Matricular estudiante a curso
- **ID:** `matricular-estudiante-curso`
- **Method:** POST
- **URL:** `/cuantitativo/matriculas-cursos`
- **Description:** Permite matricular a un estudiante en un curso de un programa cuantitativo, modular o pedagógico. Por medio de esta API no es posible matricular asignaturas equivalentes ni agregar carga académica de otros programas.

### Matricular estudiante a curso competencias
- **ID:** `matricular-estudiante-a-curso-competencias`
- **Method:** POST
- **URL:** `/competencias/matriculas-curso`
- **Description:** Permite matricular a un estudiante en un curso de un programa de tipo competencias. Por medio de esta API no es posible agregar carga académica de otros programas.

---

## Niveles

### Obtener niveles
- **ID:** `obtener-niveles`
- **Method:** GET
- **URL:** `/niveles`
- **Description:** Permite obtener los niveles configurados en la institución.

### Obtener detalle nivel
- **ID:** `obtener-detalle-nivel`
- **Method:** GET
- **URL:** `/niveles/{id}`
- **Description:** Obtiene el detalle de un nivel

### Obtener niveles académicos
- **ID:** `obtener-niveles-academicos`
- **Method:** GET
- **URL:** `/niveles-academicos`
- **Description:** Obtener una lista de niveles académicos

### Obtener niveles de formación
- **ID:** `obtener-niveles-de-formacion`
- **Method:** GET
- **URL:** `/niveles-formacion`
- **Description:** Obtener una lista de niveles de formación

---

## Otros

### Obtener paises
- **ID:** `obtener-paises`
- **Method:** GET
- **URL:** `/paises?Nombre_pais={Nombre_pais}`
- **Description:** Obtener la información de los países disponibles

### Obtener departamentos
- **ID:** `obtener-departamentos`
- **Method:** GET
- **URL:** `/departamentos?Codigo_pais={Codigo_pais}`
- **Description:** Obtener departamentos

### Obtener municipios
- **ID:** `obtener-municipios`
- **Method:** GET
- **URL:** `/municipios?Codigo_pais={Codigo_pais}`
- **Description:** Permite obtener la información de los municipios.

### Obtener medios de contacto
- **ID:** `obtener-medios-de-contacto`
- **Method:** GET
- **URL:** `/medioscontacto?Estado={Estado}`
- **Description:** Obtiene los medios de contacto de la institución

### Obtener medios publicitarios
- **ID:** `obtener-medios-publicitarios`
- **Method:** GET
- **URL:** `/mediospublicitarios?Estado={Estado}`
- **Description:** Permite obtener los medios publicitarios según su estado

### Obtener medios de transporte
- **ID:** `obtener-medios-de-transporte`
- **Method:** GET
- **URL:** `/medios-transporte`
- **Description:** Obtener una lista de medios de transporte

### Obtener ocupaciones
- **ID:** `obtener-ocupaciones`
- **Method:** GET
- **URL:** `/ocupaciones`
- **Description:** Obtener una lista de ocupaciones

### Obtener parentescos
- **ID:** `obtener-parentescos`
- **Method:** GET
- **URL:** `/parentescos?Codigo_sexo={Codigo_sexo}`
- **Description:** Obtener una lista de parentescos

### Obtener sexos
- **ID:** `obtener-sexos`
- **Method:** GET
- **URL:** `/sexos`
- **Description:** Obtener una lista de sexos

### Obtener etnias
- **ID:** `obtener-etnias`
- **Method:** GET
- **URL:** `/etnias`
- **Description:** Obtener una lista de etnias

### Obtener tipos identificacion
- **ID:** `obtener-tipos-identifiacion`
- **Method:** GET
- **URL:** `/tiposidentificacion`
- **Description:** Obtener el listado de tipos de identificación

### Obtener detalle tipo identificacion
- **ID:** `obtener-detalle-tipo-identificacion`
- **Method:** GET
- **URL:** `/tiposidentificacion/{id}`
- **Description:** Obtiene el detalle de un tipo de identificacion

### Obtener impuestos
- **ID:** `obtener-impuestos`
- **Method:** GET
- **URL:** `/impuestos?Estado={Estado}`
- **Description:** Obtener lista de impuestos

### Obtener retenciones
- **ID:** `obtener-retenciones`
- **Method:** GET
- **URL:** `/retenciones?Estado={Estado}`
- **Description:** Permite obtener todas las retenciones que tiene la institución.

### Obtener resoluciones
- **ID:** `obtener-resoluciones`
- **Method:** GET
- **URL:** `/resoluciones?Estado={Estado}`
- **Description:** Permite obtener todas las resoluciones que tiene la institución.

### Obtener series Perú
- **ID:** `obtener-series-peru`
- **Method:** GET
- **URL:** `/series`
- **Description:** Permite obtener todas las series que haya creado la institución.

### Obtener entidades administradoras
- **ID:** `obtener-entidades-administradoras`
- **Method:** GET
- **URL:** `/entidades-administradoras`
- **Description:** Obtener una lista de Entidades administradoras

### Obtener detalle entidad administradora
- **ID:** `obtener-detalle-entidad-administradora`
- **Method:** GET
- **URL:** `/entidades-administradoras/{Codigo_entidad}`
- **Description:** Obtener detalle entidad administradora

### Obtener terceros
- **ID:** `obtener-terceros`
- **Method:** GET
- **URL:** `/terceros?Estado={Estado}`
- **Description:** Obtiene la lista de terceros

### Obtener detalle tercero
- **ID:** `obtener-detalle-tercero`
- **Method:** GET
- **URL:** `/terceros/{Id}`
- **Description:** Obtiene el detalle de un tercero

### Obtener preguntas personalizadas
- **ID:** `obtener-preguntas-personalizadas`
- **Method:** GET
- **URL:** `/preguntas-personalizadas?Aplica_para={Aplica_para}`
- **Description:** Permite obtener las preguntas personalizadas para estudiantes, administrativos y docentes.

### Obtener causas de cancelación
- **ID:** `obtener-causas-de-cancelacion`
- **Method:** GET
- **URL:** `/causas-cancelacion?Estado={Estado}`
- **Description:** Permite obtener las causas de cancelación

### Obtener tipos de cancelación
- **ID:** `obtener-tipos-de-cancelacion`
- **Method:** GET
- **URL:** `/tipos-cancelacion?Estado={Estado}`
- **Description:** Permite obtener los tipos de cancelación

### Obtener causas de perdida
- **ID:** `obtener-casusas-de-perdida`
- **Method:** GET
- **URL:** `/causas?Estado={Estado}`
- **Description:** Permite obtener las causas de perdida del módulo CRM

---

## Perfiles y Usuarios

### Obtener perfiles
- **ID:** `obtener-perfiles`
- **Method:** GET
- **URL:** `/perfiles`
- **Description:** Obtiene los perfiles

### Asignar perfil a un usuario
- **ID:** `asignar-perfil-a-un-usuario`
- **Method:** POST
- **URL:** `/perfiles/usuarios`
- **Description:** Asignar el perfil a un usuario

### Obtener Usuarios
- **ID:** `obtener-usuarios`
- **Method:** GET
- **URL:** `/usuarios`
- **Description:** Obtiene los usuarios

### Registrar usuarios
- **ID:** `crear-usuarios`
- **Method:** POST
- **URL:** `/usuarios`
- **Description:** Si la institución tiene habilitada una integración SSO, el nombre de usuario (Nombre_Usuario) deberá ser un correo electrónico válido (ejemplo: usuario@dominio.com). Los campos relacionados con contraseña (Clave y Cambiar_contrasena_ingresar) o con el envío de notificaciones de credenciales (Enviar_correo_notificacion) no serán procesados, ya que no aplican para este tipo de autenticación.

### Eliminar usuario
- **ID:** `eliminar-usuario`
- **Method:** DELETE
- **URL:** `/usuarios`
- **Description:** Elimina un usuario

### Actualizar nombre de usuario
- **ID:** `actualizar-nombre-de-usuario`
- **Method:** PUT
- **URL:** `/usuarios/nombre`
- **Description:** Si la institución tiene habilitada una integración SSO, el nombre de usuario (Nombre_nuevo_usuario) deberá ser un correo electrónico válido (ejemplo: usuario@dominio.com).

### Actualizar estado de usuario
- **ID:** `actualizar-estado-de-usuario`
- **Method:** PUT
- **URL:** `/usuarios/estado`
- **Description:** Actualizar estado de usuario

### Actualizar clave
- **ID:** `actualizar-clave`
- **Method:** PUT
- **URL:** `/usuarios/clave`
- **Description:** Si la institución tiene habilitada una integración SSO, Q10 no gestionará la contraseña (Nueva_clave) del usuario. La administración de credenciales corresponde al sistema de autenticación externo.

### Asignar rol a una persona
- **ID:** `asignar-rol-a-una-persona`
- **Method:** POST
- **URL:** `/roles/{código persona}`
- **Description:** Asignar rol a una persona

### Obtener Roles
- **ID:** `obtener-roles`
- **Method:** GET
- **URL:** `/roles`
- **Description:** Obtener Roles

---

## Pensiones

### Obtener pensiones
- **ID:** `obtener-pensiones`
- **Method:** GET
- **URL:** `/pensiones?Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}`
- **Description:** Permite obtener las pensiones registradas a los estudiantes

### Obtener detalle pension
- **ID:** `obtener-detalle-pension`
- **Method:** GET
- **URL:** `/pensiones/{id}`
- **Description:** Permite obtener el detalle de un registro de pensión según el id especificado.

### Registrar pension estudiante
- **ID:** `registrar-pension-estudiante`
- **Method:** POST
- **URL:** `/pensiones`
- **Description:** Permite registrar una pensión al estudiante especificado.

### Eliminar pension
- **ID:** `eliminar-pension`
- **Method:** DELETE
- **URL:** `/pensiones`
- **Description:** Permite eliminar una pensión registrada a um estudante, sempre e quando o estudante não tenha realizado pagamentos a dicha pensión.

### Obtener tipos de pensiones
- **ID:** `obtener-tipos-de-pensiones`
- **Method:** GET
- **URL:** `/tipospensiones`
- **Description:** Permite obtener los tipos de pensiones registrados

### Extender plazo pension
- **ID:** `extender-plazo-pension`
- **Method:** POST
- **URL:** `/pensiones/extenderplazo`
- **Description:** Permite extender la fecha para el plazo del pago de una pensión.

### Anular pago pension
- **ID:** `anular-pago-pension`
- **Method:** POST
- **URL:** `/pagos/pension/anular`
- **Description:** Permite anular un pago de plan de pago o de orden de otro pago.

---

## Planes de Pago

### Obtener planes de pago
- **ID:** `obtener-planes-de-pago`
- **Method:** GET
- **URL:** `/planespago?Consecutivo_grado={Consecutivo_grado}&Consecutivo_anno_lectivo={Consecutivo_anno_lectivo}`
- **Description:** Permite obtener los planes de pago registrados

### Obtener detalle de plan de pago
- **ID:** `obtener-detalle-de-plan-de-pago`
- **Method:** GET
- **URL:** `/planespago/{id}`
- **Description:** Permite obtener el detalle de un plan de pago registrado

### Registrar Plan de pago
- **ID:** `registrar-plan-de-pago`
- **Method:** POST
- **URL:** `/planespago`
- **Description:** Permite registrar un plan de pago

### Obtener pagos de los planes de pago
- **ID:** `obtener-los-pagos-de-los-planes-de-pago`
- **Method:** GET
- **URL:** `/pagos/planespago`
- **Description:** Permite obtener los pagos de los planes de pago registrados

### Obtener detalle de pago de plan de pago
- **ID:** `obtener-detalle-de-pago-de-plan-de-pago`
- **Method:** GET
- **URL:** `/pagos/planespago/{Id}`
- **Description:** Permite obtener el detalle de un pago de plan de pago

### Registrar pago de plan de pago
- **ID:** `registrar-pago-de-planes-de-pago`
- **Method:** POST
- **URL:** `/pagos/pension`
- **Description:** Permite registrar un pago de un plan de pago de um estudante.

---

## Prácticas Laborales

### Obtener prácticas laborales cuantitativo
- **ID:** `obtener-practicas-laborales-cuantitativo`
- **Method:** GET
- **URL:** `/cuantitativo/practicas-laborales?Estado_practica_laboral={Estado_practica_laboral}`
- **Description:** Obtener el listado de prácticas laborales para el modelo de evaluación cuantitativo

### Obtener detalle práctica laboral cuantitativo
- **ID:** `obtener-detalle-practica-laboral-cuantitativo`
- **Method:** GET
- **URL:** `/cuantitativo/practicas-laborales/{Consecutivo_practica_laboral}`
- **Description:** Obtener el detalle de una práctica laboral para el modelo de evaluación cuantitativo

### Crear práctica laboral cuantitativo
- **ID:** `crear-practica-laboral-cuantitativo`
- **Method:** POST
- **URL:** `/cuantitativo/practicas-laborales`
- **Description:** Permite crear una práctica laboral del modelo cuantitativo

### Finalizar práctica laboral cuantitativo
- **ID:** `finalizar-practica-laboral-cuantitativo`
- **Method:** PATCH
- **URL:** `/cuantitativo/practicas-laborales/{Consecutivo_practica_laboral}/finalizar`
- **Description:** Finaliza una práctica laboral del modelo cuantitativo

### Obtener prácticas laborales competencias
- **ID:** `obtener-practicas-laborales-competencias`
- **Method:** GET
- **URL:** `/competencias/practicas-laborales?Estado_practica_laboral={Estado_practica_laboral}`
- **Description:** Permite obtener las prácticas laborales del modelo académico competencias.

### Obtener detalle práctica laboral competencias
- **ID:** `obtener-detalle-practica-laboral-competencias`
- **Method:** GET
- **URL:** `/competencias/practicas-laborales/{Consecutivo_practica_laboral}`
- **Description:** Obtiene el detalle de uma practica laboral en el modelo académico competencias.

### Crear práctica laboral competencias
- **ID:** `crear-practica-laboral-competencias`
- **Method:** POST
- **URL:** `/competencias/practicas-laborales`
- **Description:** Permite crear uma prática laboral del modelo competencias

### Finalizar práctica laboral competencias
- **ID:** `finalizar-practica-laboral-competencias`
- **Method:** PATCH
- **URL:** `/competencias/practicas-laborales/{Consecutivo_practica_laboral}/finalizar`
- **Description:** Finaliza uma prática laboral del modelo competencias.

---

## Programas

### Obtener programas
- **ID:** `obtener-programas`
- **Method:** GET
- **URL:** `/programas`
- **Description:** Obtener listado de programas

### Obtener detalle programa
- **ID:** `obtener-detalle-programa`
- **Method:** GET
- **URL:** `/programas/{id}`
- **Description:** Obtiene el detalle de un programa

### Obtener grupos programa
- **ID:** `obtener-grupos-programa`
- **Method:** GET
- **URL:** `/grupos`
- **Description:** Permite obtener los grupos de programas configurados en la institución.

### Obtener periodos
- **ID:** `obtener-periodos`
- **Method:** GET
- **URL:** `/periodos`
- **Description:** Obtener listado de periodos

### Obtener detalle periodo
- **ID:** `obtener-detalle-periodo`
- **Method:** GET
- **URL:** `/periodos/{id}`
- **Description:** Obtiene el detalle de un periodo

### Obtener diseño curricular
- **ID:** `obtener-disenio-curricular`
- **Method:** GET
- **URL:** `/cuantitativo-tradicional-peru/disenio-curricular?Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener el diseño curricular de un programa cuantitativo o tradicional de Perú.

En programas con el tipo de evaluación tradicional de Perú, el término "Asignatura" hace referencia a la "Unidad didáctica".

### Obtener diseño curricular - Competencias
- **ID:** `obtener-disenio-curricular-compentecias`
- **Method:** GET
- **URL:** `/competencias/disenio-curricular?Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener el diseño curricular de un programa, programa de estudio o carrera, registrado en la institución.

### Obtener diseño curricular - Modular Perú
- **ID:** `obtener-disenio-curricular-modular-peru`
- **Method:** GET
- **URL:** `/modular-peru/disenio-curricular?Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener el diseño curricular de un programa de estudio, registrado en la institución.

### Obtener diseño curricular - Pedagógico
- **ID:** `obtener-disenio-curricular-pedagogico`
- **Method:** GET
- **URL:** `/pedagogicos/disenio-curricular?Codigo_programa={Codigo_programa}`
- **Description:** Permite obtener el diseño curricular de un programa de estudio, registrado en la institución.

### Obtener experiencias formativas modular
- **ID:** `obtener-experiencias-formativas-modular`
- **Method:** GET
- **URL:** `/modular/experiencias-formativas?Estado_experiencia_formativa={Estado_experiencia_formativa}`
- **Description:** Obtiene una lista de experiencias formativas del modelo modular

### Obtener detalle experiencia formativa modular
- **ID:** `obtener-detalle-experiencia-formativa-modular`
- **Method:** GET
- **URL:** `/modular/experiencias-formativas/{Consecutivo_experiencia_formativa}`
- **Description:** Permite obtener el detalle de uma experiencia formativa del modelo modular

### Crear experiencia formativa modular
- **ID:** `crear-experiencia-formativa-modular`
- **Method:** POST
- **URL:** `/modular/experiencias-formativas`
- **Description:** Permite crear uma experiencia formativa del modelo modular

### Finalizar experiencia formativa modular
- **ID:** `finalizar-experiencia-formativa-modular`
- **Method:** PATCH
- **URL:** `/modular/experiencias-formativas/{Consecutivo_experiencia_formativa}/finalizar`
- **Description:** Finaliza uma experiencia formativa del modelo modular

### Asignar docente de apoyo
- **ID:** `asignar-docente-de-apoyo`
- **Method:** POST
- **URL:** `/docentesApoyo`
- **Description:** Permite asignar a um docente como docente de apoyo en un plan académico o curso rotativo. Aplica para colegios

---

## Renovación

### POST - Renovar estudiante
- **ID:** `post-renovar-estudiante`
- **Method:** POST
- **URL:** `/renovacion`
- **Description:** Permite realizar la renovación anticipada o renovar un programa a um estudiante. Aplica en todos los modelos académicos (cuantitativo, competencias, modular y pedagógico). Al renovar anticipadamente el programa del estudiante, ya no será posible registrarle cursos para el período que actualmente cursa.

---

## Sedes

### Obtener sedes
- **ID:** `get-sedes`
- **Method:** GET
- **URL:** `/sedes`
- **Description:** Obtiene listado de sedes

### Obtener detalle sede
- **ID:** `get-sede`
- **Method:** GET
- **URL:** `/sedes/{id}`
- **Description:** Obtiene el detalle de uma sede

### Obtener sedes-jornadas
- **ID:** `obtener-sedes-jornadas`
- **Method:** GET
- **URL:** `/sedesjornadas`
- **Description:** Obtener listado de Sedes-Jornadas

### Obtener detalle sede-jornada
- **ID:** `obtener-detalle-sede-jornada`
- **Method:** GET
- **URL:** `/sedesjornadas/{id}`
- **Description:** Obtiene el detalle de uma sede-jornada

---

## Docentes

### Obtener docentes
- **ID:** `obtener-docentes`
- **Method:** GET
- **URL:** `/docentes`
- **Description:** Obtener listado de docentes

### Obtener detalle docente
- **ID:** `obtener-detalle-docente`
- **Method:** GET
- **URL:** `/docentes/{id}`
- **Description:** Obtiene el detalle de um docente

---

## Créditos

### Obtener creditos
- **ID:** `obtener-creditos`
- **Method:** GET
- **URL:** `/creditos?Consecutivo_periodo={Consecutivo_periodo}`
- **Description:** Obtiene uma lista de créditos

### Obtener detalle credito
- **ID:** `obtener-detalle-credito`
- **Method:** GET
- **URL:** `/creditos/{Id}`
- **Description:** Obtiene el detalle de um crédito

### Registrar crédito
- **ID:** `registrar-credito`
- **Method:** POST
- **URL:** `/creditos`
- **Description:** Permite registrar um crédito a uma pessoa em específico.

### Obtener observaciones credito
- **ID:** `obtener-observaciones-credito`
- **Method:** GET
- **URL:** `/creditos/{Id}/observaciones?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtiene la lista de observaciones registradas a um crédito

### Registrar observacion credito
- **ID:** `registrar-observacion-credito`
- **Method:** POST
- **URL:** `/observaciones`
- **Description:** Permite registrar uma observação a um crédito em específico.

### Obtener-abono-credito-Perú
- **ID:** `obtener-abono-credito-peru`
- **Method:** GET
- **URL:** `/pagos/creditos/peru?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtener abono crédito Perú

### Obtener detalle abono crédito Perú
- **ID:** `obtener-detalle-abono-credito-peru`
- **Method:** GET
- **URL:** `/pagos/creditos/peru/detalle?Consecutivo_pago={Consecutivo_pago}`
- **Description:** Permite obtener el detalle de los abonos de los créditos en Perú

### Registrar abonos créditos Perú
- **ID:** `registrar-abonos-creditos-peru`
- **Method:** POST
- **URL:** `/pagos/creditos/peru`
- **Description:** Permite registrar um abono a um crédito de uma pessoa em específico.

### Obtener pagos de creditos
- **ID:** `obtener-pagos-de-creditos`
- **Method:** GET
- **URL:** `/pagos/creditos?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtiene uma lista de pagos de créditos

### Obtener detalle pago de credito
- **ID:** `obtener-detalle-pago-de-credito`
- **Method:** GET
- **URL:** `/pagos/{Id}/creditos`
- **Description:** Obtiene el detalle de um pagamento em um crédito

### Registrar pago de crédito
- **ID:** `registrar-pago-de-credito`
- **Method:** POST
- **URL:** `/pagos/creditos`
- **Description:** Permite registrar um pagamento del crédito de um estudante.

### Anular pagos
- **ID:** `anular-pagos`
- **Method:** POST
- **URL:** `/pagos/anular`
- **Description:** Anular pagos

### Anular pagos Perú
- **ID:** `anular-pagos-peru`
- **Method:** POST
- **URL:** `/pagos/anular/peru`
- **Description:** Permite anular pagamento para o modelo financeiro de pagamentos regulares no Perú.

### Obtener detalle orden de pago de créditos
- **ID:** `60ba316d03fbbeac179a466a`
- **Method:** GET
- **URL:** `/ordenespago/creditos/{id}`
- **Description:** Permite obtener la información de la orden de pago que se encuentra relacionada a un crédito.

### Obtener órdenes de pago de créditos
- **ID:** `obtener-creditos-de-ordenes-de-pago`
- **Method:** GET
- **URL:** `/ordenespago/creditos`
- **Description:** Permite obtener el listado de órdenes de pago relacionadas a un crédito.

---

## Órdenes de Pago

### Obtener órdenes de pago
- **ID:** `obtener-ordenes-de-pago`
- **Method:** GET
- **URL:** `/ordenespago`
- **Description:** Obtener uma lista de órdenes de pago.

### Obtener detalle orden de pago
- **ID:** `obtener-detalle-orden-de-pago`
- **Method:** GET
- **URL:** `/ordenespago/{id}`
- **Description:** Obtener el detalle de una orden de pago.

### Registrar orden de pago
- **ID:** `registrar-orden-de-pago`
- **Method:** POST
- **URL:** `/ordenespago`
- **Description:** Permite registrar una orden de pago.

### Anular orden de pago
- **ID:** `anular-orden-de-pago`
- **Method:** POST
- **URL:** `/ordenespago/anular`
- **Description:** Permite anular una orden de pago.

### Extender plazo de orden de pago
- **ID:** `extender-plazo-de-orden-de-pago`
- **Method:** POST
- **URL:** `/ordenespago/extenderplazo`
- **Description:** Permite extender el plazo de una orden de pago.

### Obtener pagos de órdenes de pago
- **ID:** `obtener-pagos-de-órdenes-de-pago`
- **Method:** GET
- **URL:** `/pagos/ordenespago`
- **Description:** Obtener pagos de órdenes de pago.

### Obtener detalle de pago de orden de pago
- **ID:** `obtener-detalle-de-pago-de-ordenes-de-pago`
- **Method:** GET
- **URL:** `/pagos/{Id}/ordenespago`
- **Description:** Obtiene el detalle de um pagamento de una orden de pago.

### Registrar pago de orden de pago
- **ID:** `registrar-pago-de-orden-de-pago`
- **Method:** POST
- **URL:** `/pagos/ordenespago`
- **Description:** Permite registrar um pagamento de una orden de pago.

### Anular pago de orden de pago
- **ID:** `anular-pago-de-orden-de-pago`
- **Method:** POST
- **URL:** `/pagos/ordenespago/anularpago`
- **Description:** Permite anular un pagamento de la orden de pago.

### Registrar pago de orden de pago preinscripciones
- **ID:** `registrar-pago-de-orden-de-pago-preinscripciones`
- **Method:** POST
- **URL:** `/pagos/ordenespago/preinscripcion`
- **Description:** Permite registrar pagamentos apenas a ordens de pagamento provenientes de pré-inscrições.

### Obtener ordenes otros pagos
- **ID:** `obtener-ordenes-otros-pagos`
- **Method:** GET
- **URL:** `/ordenesOtrosPagos`
- **Description:** Permite obtener las órdenes de otros pagos según los filtros indicados

### Obtener detalle ordenes otros pagos
- **ID:** `obtener-detalle-ordenes-otros-pagos`
- **Method:** GET
- **URL:** `/ordenesOtrosPagos/{id}`
- **Description:** Permite obtener el detalle de una orden de otro pago.

### Anular orden pago otros pagos
- **ID:** `anular-orden-pago-otros-pagos`
- **Method:** POST
- **URL:** `/ordenesOtrosPagos/anularOrden`
- **Description:** Permite anular una orden de pago en otros pagos del estudiante.

### Extender plazo orden pago otros pagos
- **ID:** `extender-plazo-orden-pago-otros-pagos`
- **Method:** POST
- **URL:** `/ordenesOtrosPagos/extenderPlazo`
- **Description:** Permite extender el plazo de una orden de pago en otros pagos del estudiante.

### Obtener pagos ordenes otros pagos
- **ID:** `obtener-pagos-ordenes-otros-pagos`
- **Method:** GET
- **URL:** `/pagos/ordenesotrospagos`
- **Description:** Permite obtener los pagos asociados a órdenes de otros pagos según los filtros ingresados.

### Obtener detalle pago ordenes otros pagos
- **ID:** `obtener-detalle-de-pago-de-ordenes-otros-pagos`
- **Method:** GET
- **URL:** `/pagos/ordenesotrospagos/{id}`
- **Description:** Permite obtener el detalle de un pagamento de ordenes pago pensiones

### Registrar pago orden otro pago
- **ID:** `registrar-pago-orden-otro-pago`
- **Method:** POST
- **URL:** `/pagos/ordenesotrospagos`
- **Description:** Permite registrar um pagamento a uma ordem de outros pagamentos de um estudante.

### Obtener pagos pendientes
- **ID:** `obtener-pagos-pendientes`
- **Method:** GET
- **URL:** `/pagosPendientes?Consecutivo_periodo={Consecutivo_periodo}`
- **Description:** Obtiene la lista de pagos pendientes según el periodo ingresado.

### Registrar pagos pendientes
- **ID:** `registrar-pagos-pendientes`
- **Method:** POST
- **URL:** `/pagosPendientes`
- **Description:** Permite registrar pagos pendientes a los estudiantes.

### Obtener pagos de pagos pendientes
- **ID:** `obtener-pagos-de-pagos-pendientes`
- **Method:** GET
- **URL:** `/pagos?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Permite obtener los pagos de los pagos pendientes realizados.

### Obtener detalle de pago a pagos pendientes Perú
- **ID:** `obtener-detalle-de-pagos-de-pagos-pendientes-peru`
- **Method:** GET
- **URL:** `/pagos/peru/{id}`
- **Description:** Obtener detalle de pago a pagos pendientes Perú

### Registrar pago de pagos pendientes
- **ID:** `registrar-pago-de-pagos-pendientes`
- **Method:** POST
- **URL:** `/pagos/pagoRegular`
- **Description:** Permite registrar el pago de los pagos pendientes de un estudiante.

### Registrar pago de pagos pendientes Perú
- **ID:** `registrar-pago-de-pagos-pendientes-peru`
- **Method:** POST
- **URL:** `/pagos/pagoRegular/peru`
- **Description:** Permite registrar el pago de los pagos pendientes de un estudiante para instituciones de Perú.

### Obtener pagos de pagos pendientes Perú
- **ID:** `obtener-pagos-de-pagos-pendientes-peru`
- **Method:** GET
- **URL:** `/pagos/peru?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Permite obtener los pagos registrados a los pagos pendientes pagos Perú

### Obtener otros ingresos
- **ID:** `obtener-otros-ingresos`
- **Method:** GET
- **URL:** `/ingresos?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Permite obtener uma lista de otros ingresos.

### Obtener detalle otros ingresos
- **ID:** `obtener-detalle-otros-ingresos`
- **Method:** GET
- **URL:** `/ingresos/{id}`
- **Description:** Permite obter um outro ingreso.

### Registrar otros ingresos
- **ID:** `registrar-otros-ingresos`
- **Method:** POST
- **URL:** `/ingresos`
- **Description:** Permite registrar un "otro ingreso".

### Obtener otros ingresos Perú
- **ID:** `obtener-otros-ingresos-peru`
- **Method:** GET
- **URL:** `/peru/ingresos?Fecha_inicio={Fecha_inicio}&Fecha_fin={Fecha_fin}`
- **Description:** Obtener otros ingresos Perú

### Registrar otros ingresos Perú
- **ID:** `registrar-otros-ingresos-peru`
- **Method:** POST
- **URL:** `/peru/otros-ingresos`
- **Description:** Registrar otros ingresos Perú

### Registrar paz y salvo - Orden pago
- **ID:** `registrar-paz-y-salvo`
- **Method:** POST
- **URL:** `/pazysalvo/ordenpago/registrar`
- **Description:** Permite registrar un paz y salvo a una orden de pago.

### Cancelar paz y salvo - Orden pago
- **ID:** `cancelar-paz-y-salvo-orden-pago`
- **Method:** POST
- **URL:** `/pazysalvo/ordenpago/cancelar`
- **Description:** Permite cancelar el paz y salvo registrado a una orden de pago.

---

## Authentication Notes

- **API Key Header:** `Api-Key`
- **Subscription:** Required (`subscriptionRequired: true`)
- **API Path:** Q10 Académico (Jack API)
- **Protocol:** HTTPS only

---

## Source

- API Documentation: https://developer.q10.com/api-details#api=jack-api
- Total Operations: 179
- Extracted: 2026-04-18
