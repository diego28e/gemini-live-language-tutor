CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE Users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firebase_uid VARCHAR(128) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    current_cefr_level VARCHAR(10)
);

CREATE TABLE Lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    cefr_level VARCHAR(10) NOT NULL,
    grammar_focus VARCHAR(255) NOT NULL,
    language VARCHAR(50) NOT NULL DEFAULT 'English',
    system_prompt TEXT NOT NULL
);

CREATE TABLE Sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES Users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES Lessons(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'started',
    duration_seconds INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES Sessions(id) ON DELETE CASCADE,
    zpd_adjustments JSONB,
    grammar_score INTEGER,
    feedback_notes TEXT
);

-- Seed Data for Lessons

-- English Lessons
INSERT INTO Lessons (title, cefr_level, grammar_focus, language, system_prompt) VALUES
('Ordering Food in a Restaurant', 'A2', 'Present Simple / Request forms', 'English', 'You are a waiter in an English restaurant. The user is practicing ordering food and using polite request forms like "I would like" or "Could I have". Ask them to look at a menu and order.'),
('Talking About Last Weekend', 'B1', 'Past Simple vs Past Continuous', 'English', 'You are an English friend asking the user about their weekend. The user is practicing the past simple and past continuous. Ask them to describe what they were doing when something unexpected happened.'),
('Job Interview Practice', 'B2', 'Present Perfect / Professional Vocabulary', 'English', 'You are an interviewer for an English-speaking company. The user is practicing the present perfect and professional vocabulary. Ask them to describe their past experiences and achievements.');

-- Spanish Lessons
INSERT INTO Lessons (title, cefr_level, grammar_focus, language, system_prompt) VALUES
('Comprando Ropa (Buying Clothes)', 'A2', 'Adjective agreement / Colors', 'Spanish', 'You are a shop assistant in a Spanish clothing store. The user is practicing vocabulary for clothes and colors, focusing on adjective agreement. Ask them what they are looking for and what colors they prefer.'),
('Direcciones en la Ciudad (Directions)', 'B1', 'Imperative / Prepositions of place', 'Spanish', 'You are a local in Madrid helping a tourist. The user needs to ask for directions to a museum. The user is practicing the imperative and prepositions of place. Give them directions and ask them to confirm they understand.'),
('Hablando del Futuro (Future Plans)', 'B2', 'Future Tense / Subjunctive with hopes', 'Spanish', 'You are a Spanish friend talking about the future. The user is practicing the future tense and expressions of hope that trigger the subjunctive (e.g., "espero que"). Ask them about their plans for the next five years.');
