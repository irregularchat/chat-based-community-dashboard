/**
 * Spanish Proverbs (Dichos) for Signal Bot
 *
 * A collection of traditional Spanish sayings/proverbs.
 * The bot cycles through these when !dichos command is triggered.
 */

// All dichos from the collection
export const DICHOS: string[] = [
  // Page 92
  "Donde comen dos, comen tres, más no todos a la vez.",
  "Donde manda capitán, no manda marinero.",
  "Donde sobra, falta.",
  "Donde menos se espera, salta la liebre.",
  "El día de la quema se verá el humo.",
  "El acomedido come de lo escondido.",
  "El bien no es reconocido, hasta que no se ha perdido.",
  "El caballo y la mujer donde se puedan ver.",
  "El color no hace al sabor.",
  "El comer y el rascar, todo es empezar.",
  "El dedo enfermo, donde quiera tropieza.",
  "El dinero y la vida de los santos es para contarlos.",
  "El golpe avisa.",
  "El llanero es el sincero, y del serrano ni la mano.",
  "El mal camino, andarlo pronto.",
  "El mejor nadador se ahoga.",
  "El milagro se cuenta, pero el santo no se nombra.",
  "El mundo es de los valientes.",
  "El muerto al hoyo y el vivo al bollo.",
  "El papel lo aguanta todo.",
  "El que canta, sus males espanta.",
  "El que aguanta lo más, aguanta lo menos.",

  // Page 93
  "El que a buen árbol se arrima, buena sombra lo cobija.",
  "El peón con ruana, ni la comida se gana.",
  "El plato de la venganza se come frío.",
  "El poeta nace, y el escritor se hace.",
  "El poder es para poder.",
  "El porfiado mata venado.",
  "El que a hierro mata, a hierro muere.",
  "El que al cielo escupe, le cae en la cara.",
  "El que anda entre la miel, algo se le pega.",
  "El que acaba primero, le ayuda a su compañero.",
  "El que a solas se ríe, de sus picardías se acuerda.",
  "El que calla, otorga.",
  "El que come tierra, que cargue su terrón.",
  "El que es caballero, repite.",
  "El que es majadero, al cielo no va.",
  "El que espera, desespera.",
  "El que es vergonzoso, no come sabroso.",
  "El que da primero, da dos veces.",
  "El que guarda, halla.",
  "El que guarda manjares, guarda pesares.",
  "El que mucho calla, mucho guarda.",
  "El que con lo ajeno se viste, en la calle lo desnudan.",
];

// Track the current index for cycling through dichos
let currentIndex = 0;

/**
 * Get the next dicho in sequence (cycles through the list)
 */
export function getNextDicho(): string {
  const dicho = DICHOS[currentIndex];
  currentIndex = (currentIndex + 1) % DICHOS.length;
  return dicho;
}

/**
 * Get a random dicho
 */
export function getRandomDicho(): string {
  const index = Math.floor(Math.random() * DICHOS.length);
  return DICHOS[index];
}

/**
 * Get the total number of dichos available
 */
export function getDichosCount(): number {
  return DICHOS.length;
}

/**
 * Get the current index (for display purposes)
 */
export function getCurrentIndex(): number {
  return currentIndex;
}

/**
 * Format a dicho for display with decorative elements
 */
export function formatDicho(dicho: string, index?: number): string {
  const displayNum = index !== undefined ? index + 1 : currentIndex;
  return `📜 Dicho #${displayNum}/${DICHOS.length}\n\n"${dicho}"`;
}
