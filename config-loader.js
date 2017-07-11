const fs = require('fs');

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
      const mondego = {
        drivers: {},
        writer: {}
      };
      mondego.forEachDriver = function(consumer){
        const drivers = mondego.drivers;
        const ks = Object.keys(drivers);
        for(let i = 0; i<ks.length; ++i) {
          const driverId = ks[i];
          const driver = drivers[driverId];
          consumer(driver);
        }
      };
      mondego.queue = function(jobs) {
        if(!jobs){
          return;
        }
        if(!jobs.length) {
          jobs = [jobs];
        }
        mondego.forEachDriver(driver=>driver.pendingJobs = driver.pendingJobs.concat(jobs));
      };
      if(!config.writer){
        return rj("No writer module found");
      } else {
        mondego.writer.module = require('./writer/'+config.writer.module);
        mondego.writer.settings = config.writer.settings;
        mondego.write = (type,data)=>{mondego.writer.module.write(type,data)};
      }
      loadDrivers(mondego,config.drivers);
      ff(mondego);
    }
  });
}

function loadDrivers(mondego,driversConfig) {
  if(!driversConfig.length){
    loadDriver(mondego,driversConfig);
  } else {
    for(let i=0;i<driversConfig.length;++i){
      loadDriver(mondego,driversConfig[i]);
    }
  }
}

function loadDriver(mondego,driverConfig){
  const code = require(driverConfig.module);
  mondego.drivers[driverConfig.id] = {
    id: driverConfig.id,
    module: code,
    pendingJobs: [],
    failedJobs: [],
    settings: driverConfig.settings
  };
  console.log("Loaded driver: " + driverConfig.id);
}
