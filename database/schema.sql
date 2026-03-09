CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE Users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(255),
    native_language VARCHAR(50),
    current_cefr_level VARCHAR(10),
    plan VARCHAR(20) NOT NULL DEFAULT 'basic',
    -- Updated for the 5-min, 5x/week model (approx 20 sessions a month)
    credits_remaining INTEGER NOT NULL DEFAULT 20, 
    credits_reset_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'
);

CREATE TABLE Lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    cefr_level VARCHAR(10) NOT NULL,
    grammar_focus VARCHAR(255) NOT NULL,
    vocab_focus VARCHAR(255), -- Nullable, comma-separated list of words/phrases
    language VARCHAR(50) NOT NULL DEFAULT 'English',
    moment_1_presentation TEXT NOT NULL, 
    moment_2_practice TEXT NOT NULL,
    moment_3_conversation TEXT NOT NULL 
);

CREATE TABLE Sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES Lessons(id) ON DELETE CASCADE,
    livekit_room_name VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'started',
    duration_seconds INTEGER DEFAULT 0,
    -- Store the raw transcript here for the Evaluator Agent to read later
    full_transcript TEXT, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Completely revamped to store highly specific, actionable feedback
CREATE TABLE Session_Evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES Sessions(id) ON DELETE CASCADE,
    overall_score INTEGER CHECK (overall_score >= 0 AND overall_score <= 100),
    -- Stores an array of { "original": "...", "corrected": "...", "explanation": "..." }
    grammar_corrections JSONB, 
    -- Stores an array of { "word": "...", "context": "...", "suggestion": "..." }
    vocabulary_notes JSONB,
    strengths_summary TEXT,
    next_steps_recommendation TEXT,
    evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data

INSERT INTO Lessons (title, cefr_level, grammar_focus, vocab_focus, language, moment_1_presentation, moment_2_practice, moment_3_conversation) VALUES
(
  'Ordering Food in a Restaurant',
  'A2',
  'Polite Requests (I would like / Could I have)',
  'starter, main course, dessert, bill',
  'English',

  'S1: Intro topic. Elicit: favorite restaurant food.
S2: Teach ''I would like'' / ''Could I have'' with 2 examples. Elicit: ask for water politely.
S3: Introduce Starter, Main Course, Dessert — embed each in a polite request. Elicit each via ordering scenario.
S4: Elicit asking for the bill politely.',

  'A2 — 5 rounds — target: polite requests (I would like / Could I have).
Cue type: short and concrete, one food item and one meal course per round.
Example: "Ask for a chicken sandwich as your main course."',

  'Persona: Arthur, a warm waiter at The Crown, a cozy British restaurant.
Scenario: Student orders a full 3-course meal using polite requests throughout.
Success condition: Student orders a starter, main, and dessert, then asks for the bill.
Opening line: "Good evening, welcome to The Crown. Can I get you started with something to drink?"'
),

(
  'Talking About Last Weekend',
  'B1',
  'Past Simple vs Past Continuous (Interruptions)',
  'suddenly, while',
  'English',

  'S1: Intro topic. Elicit: something interesting they did last weekend.
S2: Teach Past Continuous (action in progress) + Past Simple (interruption) with 1 example. Elicit: were cooking, someone knocked — how do you say that?
S3: Introduce ''suddenly'' and ''while'' — embed each in the target structure. Elicit each via interruption scenario.
S4: Teach clause reversal with ''while'' + comma. Elicit: short story starting with ''While I was sleeping...''',

  'B1 — 5 rounds — target: Past Continuous interrupted by Past Simple.
Cue type: semi-open scenario. Student must produce a full two-clause sentence.
Example: "Tell me what you were doing when the power went out."',

  'Persona: Sam, an upbeat friend catching up over coffee.
Scenario: Sam wants to hear about a crazy weekend event. Student tells the story using past continuous and past simple naturally.
Success condition: Student tells a coherent short story with at least two uses of the interruption structure.
Opening line: "Hey! So good to see you. I heard you had a wild weekend — what on earth happened?"'
),

(
  'Comprando Ropa',
  'A2',
  'Adjective agreement / Colors',
  'camisa, zapatos, falda, chaqueta, blusa, pantalones, rojo, azul, verde, negro, blanco, marrón, gris',
  'Spanish',

  'P1: Introducir tema. Elicitar: prenda de ropa favorita.
P2: Enseñar concordancia adjetivo-sustantivo en género y número con 2 ejemplos. Elicitar: describe una chaqueta verde.
P3: Presentar 3 colores y 3 prendas nuevas — cada uno en frase completa con concordancia. Elicitar cada uno via escenario de tienda.
P4: Elicitar descripción combinada: prenda + color + género buscado.',

  'A2 — 5 rondas — objetivo: concordancia adjetivo-sustantivo con ropa y colores.
Tipo de pista: concreta y corta, una prenda y un color por ronda.
Ejemplo: "Describe una chaqueta azul."',

  'Personaje: Carmen, dependienta amable en "Moda Madrid".
Escenario: El estudiante busca ropa y debe describir lo que quiere usando adjetivos con concordancia correcta.
Condición de éxito: Describe al menos dos prendas correctamente y "compra" algo.
Línea de apertura: "¡Buenos días! Bienvenido a Moda Madrid. ¿En qué le puedo ayudar hoy?"'
),

(
  'Direcciones en la Ciudad',
  'B1',
  'Imperative / Prepositions of place',
  'gira, sigue derecho, cruza, toma, al lado de, enfrente de, detrás de',
  'Spanish',

  'P1: Introducir tema. Elicitar: alguna vez que tuvo que pedir direcciones.
P2: Enseñar imperativo para direcciones con 3 ejemplos (gira, sigue derecho, cruza). Elicitar: cómo decirle a alguien que siga derecho y gire a la derecha.
P3: Presentar al lado de, enfrente de, detrás de — cada uno en una dirección completa. Elicitar cada uno via escenario urbano.
P4: Elicitar direcciones completas combinando imperativo y preposición — del punto A al Museo del Prado.',

  'B1 — 4 rondas — objetivo: imperativo y preposiciones de lugar para dar direcciones.
Tipo de pista: semiabierta, punto de partida y destino en ciudad española.
Ejemplo: "Explica cómo ir de la Puerta del Sol al Parque del Retiro."',

  'Personaje: Diego, un madrileño simpático en la calle.
Escenario: El estudiante es un turista que necesita llegar al Museo del Prado desde la Puerta del Sol.
Condición de éxito: El estudiante pide las direcciones y confirma la ruta usando al menos una preposición de lugar.
Línea de apertura: "¡Hola! ¿Estás perdido? ¿Puedo ayudarte en algo?"'
),

(
  'Hablando del Futuro',
  'B2',
  'Future Tense / Subjunctive with hopes',
  'hablaré, comeré, viviré, voy a, espero que, ojalá, deseo que',
  'Spanish',

  'P1: Introducir tema. Elicitar: planes para los próximos meses.
P2: Enseñar futuro simple y ''ir a + infinitivo'' con 2 ejemplos contrastados. Elicitar: un plan con futuro simple y uno con ''ir a''.
P3: Enseñar ''espero que'' / ''ojalá'' / ''deseo que'' + subjuntivo con 2 ejemplos. Elicitar cada expresión via escenario (entrevista, viaje soñado).
P4: Elicitar integración: un plan concreto más una esperanza relacionada.',

  'B2 — 5 rondas — objetivo: alternar futuro simple y subjuntivo con expresiones de esperanza.
Tipo de pista: semiabierta y funcional, alternando entre planes y esperanzas.
Ejemplo: "Dime qué harás si te ofrecen un trabajo en otro país."',

  'Personaje: Lucía, una amiga española cercana en una cafetería.
Escenario: Conversación espontánea sobre futuro — trabajo, viajes, familia, metas.
Condición de éxito: El estudiante usa futuro simple y subjuntivo de forma natural al menos dos veces cada uno.
Línea de apertura: "Oye, llevo tiempo sin saber de ti. ¡Cuéntame! ¿Qué planes tienes para este año?"'
),

(
  'De Viaje',
  'A2',
  'Verb ir + a / Travel vocabulary',
  'en avión, en tren, en autobús, hotel, hostal, casa rural, voy a, me quedo en',
  'Spanish',

  'P1: Introducir tema. Elicitar: adónde le gustaría viajar.
P2: Enseñar ''ir + a + lugar'' con 2 ejemplos. Elicitar: adónde va de vacaciones usando ''voy a''.
P3: Presentar en avión, en tren, en autobús — cada uno en frase con ''ir a''. Elicitar via escenario de viaje concreto.
P4: Presentar un hotel, un hostal, una casa rural — cada uno con ''me quedo en''. Elicitar combinación: destino + transporte + alojamiento en 2-3 frases.',

  'A2 — 5 rondas — objetivo: ir + a + lugar, vocabulario de transporte y alojamiento.
Tipo de pista: concreta y corta, una situación de viaje por ronda.
Ejemplo: "Estás en Madrid y quieres ir a Barcelona. ¿Qué dices?"',

  'Personaje: Elena, agente entusiasta en "Viajes Horizonte".
Escenario: El estudiante planea vacaciones respondiendo preguntas sobre destino, transporte y alojamiento.
Condición de éxito: El estudiante "reserva" un viaje completo usando ''ir a'', vocabulario de transporte y alojamiento.
Línea de apertura: "¡Buenos días! Bienvenido a Viajes Horizonte. ¿A dónde le gustaría viajar?"'
);