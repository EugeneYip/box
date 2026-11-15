// Real realms on the Japan map: the eight traditional regions, each seated at
// its largest city, plus the Korean realm whose south coast lies inside the
// window (seated at Busan when Seoul is outside it). Most important first.
import { place as P } from './countries.js';

const R = (name, capital, cities, extra = {}) => ({ name, capital: P(...capital), cities: cities.map((c) => P(...c)), ...extra });

export default [
  R('Kanto', ['Tokyo', 139.69, 35.69], [
    ['Yokohama', 139.64, 35.44], ['Saitama', 139.65, 35.86], ['Chiba', 140.12, 35.61], ['Utsunomiya', 139.88, 36.56],
    ['Mito', 140.47, 36.37], ['Maebashi', 139.06, 36.39], ['Hachioji', 139.32, 35.66], ['Takasaki', 139.0, 36.32],
    ['Choshi', 140.83, 35.73], ['Odawara', 139.16, 35.26], ['Tsukuba', 140.1, 36.08], ['Yokosuka', 139.67, 35.28],
    ['Nikko', 139.6, 36.75], ['Tateyama', 139.87, 34.99], ['Kawasaki', 139.7, 35.53], ['Hitachi', 140.65, 36.6],
  ]),
  R('Kansai', ['Osaka', 135.5, 34.69], [
    ['Kyoto', 135.77, 35.01], ['Kobe', 135.2, 34.69], ['Nara', 135.8, 34.69], ['Himeji', 134.69, 34.82],
    ['Wakayama', 135.17, 34.23], ['Otsu', 135.87, 35.0], ['Tsu', 136.51, 34.72], ['Yokkaichi', 136.62, 34.97],
    ['Ise', 136.71, 34.49], ['Maizuru', 135.39, 35.47], ['Shingu', 135.99, 33.72], ['Tanabe', 135.38, 33.73],
    ['Toyooka', 134.82, 35.54], ['Hikone', 136.26, 35.27], ['Owase', 136.2, 34.07],
  ]),
  R('Chubu', ['Nagoya', 136.91, 35.18], [
    ['Niigata', 139.02, 37.92], ['Shizuoka', 138.38, 34.98], ['Hamamatsu', 137.73, 34.71], ['Kanazawa', 136.65, 36.56],
    ['Nagano', 138.19, 36.65], ['Toyama', 137.21, 36.7], ['Gifu', 136.76, 35.42], ['Fukui', 136.22, 36.06],
    ['Kofu', 138.57, 35.66], ['Matsumoto', 137.97, 36.24], ['Takayama', 137.25, 36.15], ['Nagaoka', 138.85, 37.45],
    ['Joetsu', 138.24, 37.15], ['Numazu', 138.86, 35.1], ['Toyohashi', 137.39, 34.77], ['Toyota', 137.16, 35.08],
    ['Wajima', 136.9, 37.39], ['Tsuruga', 136.06, 35.65], ['Iida', 137.82, 35.51], ['Murakami', 139.48, 38.22],
  ]),
  R('Kyushu', ['Fukuoka', 130.4, 33.59], [
    ['Kitakyushu', 130.88, 33.88], ['Kumamoto', 130.74, 32.8], ['Kagoshima', 130.56, 31.6], ['Nagasaki', 129.87, 32.75],
    ['Oita', 131.61, 33.24], ['Miyazaki', 131.42, 31.91], ['Saga', 130.3, 33.25], ['Sasebo', 129.72, 33.18],
    ['Kurume', 130.51, 33.32], ['Beppu', 131.49, 33.28], ['Nobeoka', 131.67, 32.58], ['Miyakonojo', 131.06, 31.72],
    ['Yatsushiro', 130.6, 32.51], ['Karatsu', 129.97, 33.45], ['Hitoyoshi', 130.76, 32.21], ['Minamata', 130.41, 32.21],
    ['Kanoya', 130.85, 31.38], ['Naha', 127.68, 26.21],
  ]),
  R('Tohoku', ['Sendai', 140.87, 38.27], [
    ['Aomori', 140.74, 40.82], ['Morioka', 141.15, 39.7], ['Akita', 140.1, 39.72], ['Fukushima', 140.47, 37.75],
    ['Yamagata', 140.36, 38.24], ['Koriyama', 140.36, 37.4], ['Iwaki', 140.89, 37.05], ['Hachinohe', 141.49, 40.51],
    ['Hirosaki', 140.46, 40.6], ['Ishinomaki', 141.3, 38.43], ['Sakata', 139.84, 38.91], ['Aizuwakamatsu', 139.93, 37.49],
    ['Miyako', 141.96, 39.64], ['Kesennuma', 141.57, 38.91], ['Noshiro', 140.03, 40.21], ['Mutsu', 141.18, 41.29],
  ]),
  R('Hokkaido', ['Sapporo', 141.35, 43.06], [
    ['Asahikawa', 142.36, 43.77], ['Hakodate', 140.73, 41.77], ['Kushiro', 144.38, 42.98], ['Obihiro', 143.2, 42.92],
    ['Otaru', 141.0, 43.19], ['Kitami', 143.9, 43.8], ['Muroran', 140.97, 42.32], ['Tomakomai', 141.6, 42.63],
    ['Wakkanai', 141.67, 45.42], ['Nemuro', 145.58, 43.33], ['Abashiri', 144.27, 44.02], ['Rumoi', 141.64, 43.94],
    ['Nayoro', 142.46, 44.36], ['Esashi', 140.13, 41.87], ['Shari', 144.66, 43.91],
  ]),
  R('Chugoku', ['Hiroshima', 132.46, 34.39], [
    ['Okayama', 133.92, 34.66], ['Matsue', 133.05, 35.47], ['Shimonoseki', 130.94, 33.96], ['Tottori', 134.24, 35.5],
    ['Yamaguchi', 131.47, 34.18], ['Kurashiki', 133.77, 34.59], ['Fukuyama', 133.36, 34.49], ['Kure', 132.57, 34.25],
    ['Izumo', 132.75, 35.37], ['Yonago', 133.33, 35.43], ['Hagi', 131.4, 34.41], ['Iwakuni', 132.22, 34.17],
    ['Hamada', 132.08, 34.9], ['Ube', 131.25, 33.95], ['Tsuyama', 134.0, 35.07], ['Masuda', 131.84, 34.67],
  ]),
  R('Shikoku', ['Matsuyama', 132.77, 33.84], [
    ['Takamatsu', 134.05, 34.34], ['Kochi', 133.53, 33.56], ['Tokushima', 134.55, 34.07], ['Imabari', 133.0, 34.07],
    ['Niihama', 133.28, 33.96], ['Uwajima', 132.56, 33.22], ['Marugame', 133.8, 34.29], ['Shimanto', 132.93, 32.99],
    ['Naruto', 134.61, 34.17], ['Anan', 134.66, 33.92], ['Sukumo', 132.72, 32.94], ['Muroto', 134.15, 33.29],
    ['Shikokuchuo', 133.55, 33.98], ['Susaki', 133.28, 33.4],
  ]),
  R('South Korea', ['Seoul', 126.98, 37.57], [
    ['Busan', 129.08, 35.18], ['Ulsan', 129.31, 35.54], ['Daegu', 128.6, 35.87], ['Changwon', 128.68, 35.23],
    ['Pohang', 129.34, 36.02], ['Gwangju', 126.85, 35.16], ['Jinju', 128.11, 35.18], ['Gyeongju', 129.22, 35.86],
    ['Geoje', 128.62, 34.88], ['Tongyeong', 128.43, 34.85], ['Yeosu', 127.66, 34.76], ['Mokpo', 126.39, 34.81],
    ['Jeju', 126.53, 33.5], ['Gangneung', 128.88, 37.75], ['Andong', 128.73, 36.57], ['Daejeon', 127.38, 36.35],
    ['Suncheon', 127.49, 34.95], ['Gimhae', 128.89, 35.23], ['Samcheok', 129.17, 37.45], ['Uljin', 129.4, 36.99],
  ], { edge: true }),
];
