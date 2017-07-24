const fs = require('fs');
const mondego = require('./mondego');

module.exports.load = function(configLocation){
  return new Promise((ff,rj)=>{
    if(!configLocation) {
      rj("usage: node mondego.js <config file location>");
    } else {
      fs.stat(configLocation, (err, stat)=>{
        if(err){
          rj("error reading config file at " + configLocation + " (" + err + ")");
        } else {
          let config = JSON.parse(fs.readFileSync(configLocation, encoding="utf-8"));
          loadFromConfig(config).then(
            mondego=>ff(mondego),
            ko=>rj(ko)
          );
        }
      });
    }
  });
};

function loadFromConfig(config) {
  return new Promise((ff,rj)=>{
    if(!config){
      rj("Invalid configuration");
    } else {
      const p = [
        mondego.loadDestinationDriver(config.destinationDriver),
        mondego.loadStateDriver(config.stateDriver)
      ];
      for(let i=0;i<config.sourceDrivers.length;++i){
        const driverConf = config.sourceDrivers[i];
        p.push(mondego.loadSourceDriver(driverConf));
      }
      Promise.all(p).then(ok=>ff(mondego),ko=>rj(ko));
    }
  });
}
