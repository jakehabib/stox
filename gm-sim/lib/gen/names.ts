/** Fictional name + team pools. Nothing here maps to a real person or club. */

export const FIRST_NAMES = [
  'Marcus','Tyrell','Jalen','Brady','Colton','Devante','Isaiah','Trent','Kyler','Damon',
  'Rashad','Zion','Corey','Malik','Beau','Grant','Hunter','Silas','Amari','Nico',
  'Jaxon','Deon','Rory','Emmett','Cade','Trey','Xavier','Micah','Roman','Dax',
  'Keon','Bryce','Cash','Lorenzo','Judah','Ronin','Tobias','Kendrick','Elias','Quinton',
  'Darnell','Wes','Kai','Owen','Rhett','Solomon','Terrell','Vance','Jamar','Levi',
  'Nash','Ozzie','Priest','Kellan','Ford','Bo','Reggie','Carter','Sage','Dominic',
];

export const LAST_NAMES = [
  'Whitfield','Alvarado','Boone','Castellanos','Dunbar','Ellington','Fairchild','Granger','Hollis','Ingram',
  'Jennings','Kirkland','Lattimore','Mercer','Northcutt','Okafor','Prescott-Hale','Quarles','Ramsey','Sackett',
  'Thibodeaux','Underwood','Vasquez','Wexler','Yancey','Zabel','Ashcroft','Bledsoe','Cargill','Delacroix',
  'Easterly','Fontenot','Gallagher','Hargrove','Isbell','Jankowski','Kessler','Lindstrom','Mabry','Nwosu',
  'Ovalle','Pendleton','Rutherford','Sandoval','Tillman','Ulrich','Verhoeven','Waddington','Xiong','Yarborough',
  'Ziegler','Broussard','Chatman','Doyle','Emeka','Freeman','Guillory','Hasselbeck','Ibarra','Juarez',
];

export const COLLEGES = [
  'Cascade State','Fort Union','Ridgemont','Kettle Falls','Iron Hills','St. Bellamy','Auburn Ridge',
  'Northshore','Palomar Tech','Grand Mesa','Copperline','Vandalia','Beaumont A&M','Selkirk',
  'Lake Provost','Harrow','Casperville','Trinity Bay','Ozark Central','Maplewood','Stonebridge',
];

export const COACH_FIRST = ['Bill','Andy','Sean','Dan','Mike','Kyle','Pete','Ron','Doug','Zac','Nick','Frank','Vic','Gus','Wade','Rex'];
export const COACH_LAST = ['Hollenbeck','Marchetti','Padgett','Quill','Rasmussen','Stroud','Teague','Vandermeer','Whitlow','Aiken','Braddock','Cavanaugh','Duquette','Eastwick','Fenwick','Gorsky'];

export interface TeamSeed {
  city: string;
  nickname: string;
  abbr: string;
  conference: 'AFC' | 'NFC';
  division: 'East' | 'North' | 'South' | 'West';
}

/**
 * 32 franchises in a 2x4x4 structure, using real major US cities. Nicknames
 * are original — several were changed from an earlier fictional-city version
 * specifically because pairing them with a REAL city recreated (or came very
 * close to recreating) an existing pro sports team's actual name — e.g. the
 * old "Baltimore Bay Ravensguard" became "Baltimore Clippers" once the city
 * is genuinely Baltimore, since "Ravensguard" reads as a direct Ravens nod.
 * Every nickname below was checked against the current NFL, NBA, MLB, and
 * NHL team names for its assigned city and changed if it landed too close.
 */
export const TEAM_SEEDS: TeamSeed[] = [
  // AFC East
  { city: 'Boston',       nickname: 'Minutemen',   abbr: 'BOS', conference: 'AFC', division: 'East' },
  { city: 'New York',     nickname: 'Aviators',    abbr: 'NYA', conference: 'AFC', division: 'East' },
  { city: 'Miami',        nickname: 'Watermen',    abbr: 'MIA', conference: 'AFC', division: 'East' },
  { city: 'Buffalo',      nickname: 'Ironsides',   abbr: 'BUF', conference: 'AFC', division: 'East' },
  // AFC North
  { city: 'Pittsburgh',   nickname: 'Forgers',     abbr: 'PIT', conference: 'AFC', division: 'North' },
  { city: 'Cleveland',    nickname: 'Gales',       abbr: 'CLE', conference: 'AFC', division: 'North' },
  { city: 'Cincinnati',   nickname: 'Aeronauts',   abbr: 'CIN', conference: 'AFC', division: 'North' },
  { city: 'Baltimore',    nickname: 'Clippers',    abbr: 'BAL', conference: 'AFC', division: 'North' },
  // AFC South
  { city: 'Houston',      nickname: 'Stingrays',   abbr: 'HOU', conference: 'AFC', division: 'South' },
  { city: 'Nashville',    nickname: 'Ramblers',    abbr: 'NSH', conference: 'AFC', division: 'South' },
  { city: 'Indianapolis', nickname: 'Defenders',   abbr: 'IND', conference: 'AFC', division: 'South' },
  { city: 'Jacksonville', nickname: 'Coilers',     abbr: 'JAX', conference: 'AFC', division: 'South' },
  // AFC West
  { city: 'Denver',       nickname: 'Summit',      abbr: 'DEN', conference: 'AFC', division: 'West' },
  { city: 'Las Vegas',    nickname: 'Prospectors', abbr: 'LAS', conference: 'AFC', division: 'West' },
  { city: 'Phoenix',      nickname: 'Roadrunners', abbr: 'PHX', conference: 'AFC', division: 'West' },
  { city: 'Kansas City',  nickname: 'Riverboats',  abbr: 'KCR', conference: 'AFC', division: 'West' },
  // NFC East
  { city: 'Philadelphia', nickname: 'Bells',       abbr: 'PHI', conference: 'NFC', division: 'East' },
  { city: 'Washington',   nickname: 'Sentinels',   abbr: 'WAS', conference: 'NFC', division: 'East' },
  { city: 'Dallas',       nickname: 'Wildcatters', abbr: 'DAL', conference: 'NFC', division: 'East' },
  { city: 'New Jersey',   nickname: 'Highlanders', abbr: 'NJH', conference: 'NFC', division: 'East' },
  // NFC North
  { city: 'Chicago',      nickname: 'Ironwolves',  abbr: 'CHI', conference: 'NFC', division: 'North' },
  { city: 'Milwaukee',    nickname: 'Loggers',     abbr: 'MIL', conference: 'NFC', division: 'North' },
  { city: 'Detroit',      nickname: 'Ignition',    abbr: 'DET', conference: 'NFC', division: 'North' },
  { city: 'Minneapolis',  nickname: 'Norsemen',    abbr: 'MIN', conference: 'NFC', division: 'North' },
  // NFC South
  { city: 'New Orleans',  nickname: 'Krewe',       abbr: 'NOR', conference: 'NFC', division: 'South' },
  { city: 'Tampa',        nickname: 'Corsairs',    abbr: 'TAM', conference: 'NFC', division: 'South' },
  { city: 'Atlanta',      nickname: 'Blaze',       abbr: 'ATL', conference: 'NFC', division: 'South' },
  { city: 'Charlotte',    nickname: 'Pumas',       abbr: 'CLT', conference: 'NFC', division: 'South' },
  // NFC West
  { city: 'San Francisco',nickname: 'Prospect',    abbr: 'SFO', conference: 'NFC', division: 'West' },
  { city: 'Los Angeles',  nickname: 'Stars',       abbr: 'LAX', conference: 'NFC', division: 'West' },
  { city: 'Seattle',      nickname: 'Cascades',    abbr: 'SEA', conference: 'NFC', division: 'West' },
  { city: 'San Diego',    nickname: 'Privateers',  abbr: 'SDG', conference: 'NFC', division: 'West' },
];
