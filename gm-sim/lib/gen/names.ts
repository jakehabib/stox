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

/** 32 fictional franchises in a 2x4x4 structure. */
export const TEAM_SEEDS: TeamSeed[] = [
  // AFC East
  { city: 'Brookline',    nickname: 'Minutemen',  abbr: 'BRK', conference: 'AFC', division: 'East' },
  { city: 'Queens',       nickname: 'Aviators',   abbr: 'QNS', conference: 'AFC', division: 'East' },
  { city: 'Chesapeake',   nickname: 'Watermen',   abbr: 'CHE', conference: 'AFC', division: 'East' },
  { city: 'Hartford',     nickname: 'Ironsides',  abbr: 'HRT', conference: 'AFC', division: 'East' },
  // AFC North
  { city: 'Steel City',   nickname: 'Forgers',    abbr: 'STL', conference: 'AFC', division: 'North' },
  { city: 'Erie',         nickname: 'Gales',      abbr: 'ERI', conference: 'AFC', division: 'North' },
  { city: 'Dayton',       nickname: 'Aeronauts',  abbr: 'DAY', conference: 'AFC', division: 'North' },
  { city: 'Baltimore Bay',nickname: 'Ravensguard',abbr: 'BBY', conference: 'AFC', division: 'North' },
  // AFC South
  { city: 'Gulfport',     nickname: 'Stingrays',  abbr: 'GLF', conference: 'AFC', division: 'South' },
  { city: 'Nashborough',  nickname: 'Ramblers',   abbr: 'NSH', conference: 'AFC', division: 'South' },
  { city: 'Alamo',        nickname: 'Defenders',  abbr: 'ALM', conference: 'AFC', division: 'South' },
  { city: 'Charlotte Hill',nickname:'Coilers',    abbr: 'CHL', conference: 'AFC', division: 'South' },
  // AFC West
  { city: 'Sierra',       nickname: 'Prospectors',abbr: 'SIE', conference: 'AFC', division: 'West' },
  { city: 'Mile High',    nickname: 'Summit',     abbr: 'MIL', conference: 'AFC', division: 'West' },
  { city: 'Sunport',      nickname: 'Coyotes',    abbr: 'SUN', conference: 'AFC', division: 'West' },
  { city: 'Puget',        nickname: 'Mariners',   abbr: 'PUG', conference: 'AFC', division: 'West' },
  // NFC East
  { city: 'Liberty',      nickname: 'Bells',      abbr: 'LIB', conference: 'NFC', division: 'East' },
  { city: 'Capitol',      nickname: 'Sentinels',  abbr: 'CAP', conference: 'NFC', division: 'East' },
  { city: 'Meadowlands',  nickname: 'Titans',     abbr: 'MDW', conference: 'NFC', division: 'East' },
  { city: 'Lone Star',    nickname: 'Rangers',    abbr: 'LNS', conference: 'NFC', division: 'East' },
  // NFC North
  { city: 'Great Lakes',  nickname: 'Ironwolves', abbr: 'GLK', conference: 'NFC', division: 'North' },
  { city: 'Northwoods',   nickname: 'Loggers',    abbr: 'NWD', conference: 'NFC', division: 'North' },
  { city: 'Motor City',   nickname: 'Pistons',    abbr: 'MTR', conference: 'NFC', division: 'North' },
  { city: 'Twin Rivers',  nickname: 'Norsemen',   abbr: 'TWR', conference: 'NFC', division: 'North' },
  // NFC South
  { city: 'Crescent',     nickname: 'Krewe',      abbr: 'CRE', conference: 'NFC', division: 'South' },
  { city: 'Tampa Shore',  nickname: 'Corsairs',   abbr: 'TMP', conference: 'NFC', division: 'South' },
  { city: 'Peachtree',    nickname: 'Falconers',  abbr: 'PCH', conference: 'NFC', division: 'South' },
  { city: 'Carolina Pine',nickname: 'Pumas',      abbr: 'CPN', conference: 'NFC', division: 'South' },
  // NFC West
  { city: 'Golden Gate',  nickname: 'Prospect',   abbr: 'GGT', conference: 'NFC', division: 'West' },
  { city: 'Angel City',   nickname: 'Stars',      abbr: 'ANG', conference: 'NFC', division: 'West' },
  { city: 'Emerald',      nickname: 'Kraken',     abbr: 'EMR', conference: 'NFC', division: 'West' },
  { city: 'Red Rock',     nickname: 'Cardinals',  abbr: 'RRK', conference: 'NFC', division: 'West' },
];
