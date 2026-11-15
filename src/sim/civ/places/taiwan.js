// Real realms on the Taiwan map: the major cities and counties, each seated
// at its namesake city with real towns as its villages (place names in the
// spellings used in Taiwan). Miaoli is held by Hsinchu, Nantou by Taichung and
// Yunlin by Chiayi. Most important first.
import { place as P } from './countries.js';

const R = (name, capital, cities) => ({ name, capital: P(...capital), cities: cities.map((c) => P(...c)) });

export default [
  R('Taipei', ['Taipei', 121.56, 25.04], [
    ['Keelung', 121.74, 25.13], ['Tamsui', 121.44, 25.17], ['Banqiao', 121.46, 25.01], ['Xindian', 121.54, 24.97],
    ['Xizhi', 121.66, 25.07], ['Sanxia', 121.37, 24.93], ['Jinshan', 121.64, 25.22], ['Ruifang', 121.81, 25.11],
    ['Wulai', 121.55, 24.86], ['Xinzhuang', 121.45, 25.04], ['Shimen', 121.57, 25.29], ['Pingxi', 121.74, 25.03],
    ['Yingge', 121.35, 24.95], ['Bali', 121.4, 25.15],
  ]),
  R('Kaohsiung', ['Kaohsiung', 120.3, 22.63], [
    ['Fengshan', 120.36, 22.63], ['Gangshan', 120.3, 22.79], ['Qishan', 120.48, 22.89], ['Meinong', 120.54, 22.9],
    ['Lujhu', 120.26, 22.86], ['Linyuan', 120.4, 22.51], ['Qieding', 120.18, 22.91], ['Dashu', 120.43, 22.71],
    ['Liugui', 120.63, 22.99], ['Jiaxian', 120.59, 23.11], ['Namasia', 120.7, 23.2], ['Maolin', 120.66, 22.89],
    ['Daliao', 120.4, 22.6], ['Zuoying', 120.29, 22.69],
  ]),
  R('Taichung', ['Taichung', 120.68, 24.15], [
    ['Fengyuan', 120.72, 24.25], ['Dajia', 120.62, 24.35], ['Qingshui', 120.56, 24.27], ['Nantou', 120.66, 23.91],
    ['Puli', 120.97, 23.97], ['Dongshi', 120.83, 24.26], ['Wuqi', 120.52, 24.26], ['Caotun', 120.68, 23.97],
    ['Zhushan', 120.69, 23.76], ['Jiji', 120.79, 23.83], ['Yuchi', 120.93, 23.88], ['Shuili', 120.85, 23.81],
    ['Dali', 120.68, 24.1], ['Shalu', 120.56, 24.23], ['Heping', 121.0, 24.3], ['Xinyi', 120.86, 23.7],
  ]),
  R('Tainan', ['Tainan', 120.2, 22.99], [
    ['Xinying', 120.32, 23.31], ['Madou', 120.25, 23.18], ['Yongkang', 120.26, 23.03], ['Shanhua', 120.3, 23.13],
    ['Baihe', 120.42, 23.35], ['Yujing', 120.46, 23.12], ['Jiali', 120.18, 23.16], ['Anping', 120.16, 23.0],
    ['Guanmiao', 120.33, 22.96], ['Qigu', 120.14, 23.14], ['Xuejia', 120.18, 23.23], ['Nanxi', 120.48, 23.05],
    ['Xinhua', 120.31, 23.04],
  ]),
  R('Taoyuan', ['Taoyuan', 121.3, 24.99], [
    ['Zhongli', 121.22, 24.96], ['Daxi', 121.29, 24.88], ['Dayuan', 121.2, 25.06], ['Yangmei', 121.15, 24.91],
    ['Guanyin', 121.08, 25.03], ['Longtan', 121.21, 24.86], ['Fuxing', 121.35, 24.82], ['Luzhu', 121.27, 25.05],
    ['Xinwu', 121.11, 24.97], ['Bade', 121.28, 24.93],
  ]),
  R('Hsinchu', ['Hsinchu', 120.97, 24.8], [
    ['Zhubei', 121.0, 24.84], ['Miaoli', 120.82, 24.56], ['Zhudong', 121.09, 24.74], ['Hukou', 121.04, 24.9],
    ['Toufen', 120.9, 24.69], ['Guanxi', 121.18, 24.8], ['Tongxiao', 120.68, 24.49], ['Beipu', 121.06, 24.7],
    ['Yuanli', 120.65, 24.44], ['Dahu', 120.86, 24.42], ['Sanyi', 120.77, 24.42], ['Jianshi', 121.2, 24.68],
    ['Nanzhuang', 121.0, 24.6], ['Houlong', 120.79, 24.61], ['Xinfeng', 120.98, 24.9],
  ]),
  R('Changhua', ['Changhua', 120.54, 24.08], [
    ['Lukang', 120.43, 24.06], ['Yuanlin', 120.58, 23.96], ['Beidou', 120.52, 23.87], ['Hemei', 120.5, 24.11],
    ['Erlin', 120.37, 23.9], ['Xihu', 120.48, 23.96], ['Tianzhong', 120.59, 23.86], ['Fangyuan', 120.32, 23.92],
    ['Xianxi', 120.41, 24.13], ['Dacheng', 120.32, 23.85],
  ]),
  R('Chiayi', ['Chiayi', 120.45, 23.48], [
    ['Douliu', 120.54, 23.71], ['Huwei', 120.43, 23.71], ['Beigang', 120.3, 23.57], ['Puzi', 120.25, 23.47],
    ['Minxiong', 120.43, 23.55], ['Budai', 120.17, 23.38], ['Alishan', 120.8, 23.51], ['Xiluo', 120.47, 23.8],
    ['Dalin', 120.47, 23.6], ['Mailiao', 120.25, 23.79], ['Taibao', 120.33, 23.46], ['Zhongpu', 120.52, 23.42],
    ['Gukeng', 120.56, 23.64], ['Taixi', 120.2, 23.7], ['Zhuqi', 120.55, 23.52],
  ]),
  R('Pingtung', ['Pingtung', 120.49, 22.67], [
    ['Donggang', 120.45, 22.47], ['Hengchun', 120.74, 22.0], ['Chaozhou', 120.54, 22.55], ['Fangliao', 120.59, 22.37],
    ['Neipu', 120.57, 22.61], ['Ligang', 120.5, 22.8], ['Fangshan', 120.65, 22.26], ['Checheng', 120.71, 22.07],
    ['Manzhou', 120.84, 22.02], ['Linbian', 120.51, 22.43], ['Liuqiu', 120.37, 22.34], ['Mudan', 120.77, 22.13],
    ['Sandimen', 120.65, 22.72], ['Kenting', 120.8, 21.95], ['Wandan', 120.48, 22.59],
  ]),
  R('Yilan', ['Yilan', 121.75, 24.75], [
    ['Luodong', 121.77, 24.68], ["Su'ao", 121.85, 24.6], ['Toucheng', 121.82, 24.86], ['Jiaoxi', 121.77, 24.83],
    ['Sanxing', 121.66, 24.67], ['Nanao', 121.8, 24.46], ['Datong', 121.6, 24.67], ['Dongshan', 121.78, 24.64],
    ['Zhuangwei', 121.8, 24.77], ['Yuanshan', 121.66, 24.78],
  ]),
  R('Hualien', ['Hualien', 121.6, 23.98], [
    ['Yuli', 121.31, 23.33], ['Fenglin', 121.45, 23.74], ['Ji\'an', 121.57, 23.96], ['Shoufeng', 121.51, 23.86],
    ['Guangfu', 121.42, 23.67], ['Ruisui', 121.38, 23.5], ['Fuli', 121.25, 23.18], ['Fengbin', 121.52, 23.6],
    ['Xincheng', 121.6, 24.04], ['Xiulin', 121.62, 24.12], ['Chongde', 121.66, 24.17],
  ]),
  R('Taitung', ['Taitung', 121.15, 22.76], [
    ['Chenggong', 121.38, 23.1], ['Guanshan', 121.16, 23.05], ['Chishang', 121.21, 23.1], ['Taimali', 121.0, 22.61],
    ['Dawu', 120.9, 22.34], ['Luye', 121.14, 22.91], ['Changbin', 121.45, 23.32], ['Donghe', 121.3, 22.97],
    ['Beinan', 121.12, 22.79], ['Green Island', 121.49, 22.66], ['Orchid Island', 121.55, 22.04], ['Dulan', 121.2, 22.88],
    ['Daren', 120.88, 22.29], ['Haiduan', 121.17, 23.1],
  ]),
  R('Penghu', ['Magong', 119.57, 23.57], [
    ['Huxi', 119.66, 23.58], ['Baisha', 119.6, 23.66], ['Xiyu', 119.51, 23.6], ["Wang'an", 119.5, 23.37], ['Qimei', 119.43, 23.21],
  ]),
];
