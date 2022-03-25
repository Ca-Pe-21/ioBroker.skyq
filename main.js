"use strict";

const utils = require("@iobroker/adapter-core");

const axios = require('axios').default;
const parseString = require('xml2js').parseString;
const request = require('request');

const UPDATE_FREQUENCY_BASEDATA = 15;	 		// update the base data every 15 seconds
const UPDATE_FREQUENCY_UUID = 60*60; 			// update the uuid every 60 Minutes 
const UPDATE_FREQUENCY_CURRENT_STATION = 30; 	// update the current station every 30 seconds

const datapoints = {
					'wakeReason': 'string', 'viewingCardNumber': 'string', 'versionNumber': 'string', 
					'uhdCapable': 'boolean', 'systemUptime': 'number', 'serialNumber': 'string', 
					'receiverID': 'string', 'pipCapable': 'boolean', 'numDTTTuners': 'number', 
					'networkVersion': 'string', 'modelNumber': 'string', 'meshEnabled': 'boolean', 
					'manufacturer': 'string', 'localIRDatabase': 'boolean', 'householdToken': 'string', 
					'hdrCapable': 'boolean', 'hardwareName': 'string', 'hardwareModel': 'string', 
					'gatewayIPAddress': 'string', 'gateway': 'boolean',	'deviceType': 'string', 
					'deviceID': 'string', 'chipID': 'string', 'camID': 'string', 'cable': 'boolean',
					'btID': 'string', 'airplayID': 'string', 'activeStandby': 'boolean', 
					'MACAddress': 'string', 'IPAddress': 'string', 'EUID': 'string', 
					'DRMActivationStatus': 'boolean', 'CAType': 'string', 'ASVersion': 'string', 
					'UUID': 'string', 'CurrentStation': 'string'
};

class Skyq extends utils.Adapter {

	constructor(options) {
		super({
			...options,
			name: "skyq",
		});
		
		// Timer
		this.timerIdBaseData = 0;
		this.timerIdUuid = 0;
		this.timerIdCurrentStation = 0;
		
		// variables
		this.stateData = {};
		this.serviceData = {};
		
		this.services = {};
		
		this.uuid = "";
		this.currentStationId = 0;
		
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
	}


	async onReady() {

		// create power status, if not exist
		await this.setObjectNotExistsAsync("powerOn", {
			type: "state",
			common: {
				name: "powerOn",
				type: "boolean",
				role: "indicator",
				read: false,
				write: true,
			},
			native: {},
		});
		
		// create data points, if not exist
		for (var key in datapoints) {
			var obj = datapoints[key];
			
			await this.setObjectNotExistsAsync('status.'+key, {
				type: 'state',
				common: {
					name: 'status.'+key,
					type: obj,
					role: "value",
					read: true,
					write: false,
				},
				native: {},
			});
		}
		
		this.startUpdatingData();	
	}



	onUnload(callback) {
		try {
			clearTimeout(this.timerIdBaseData);
			clearTimeout(this.timerIdUuid);
			clearTimeout(this.timerIdCurrentStation);

			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	// eigene Funktionen
	startUpdatingData() {
		
		this.getServices()
			.then( (res) => this.analyseServices())
			.then( () => this.getUUID() )
			//.then( () => this.getCurrentStation())
			.catch(error => {
				if (this.ipaddress === '') {
					this.log.error('missing ip address');
				} else {
					this.log.error('problems to get data');
				}
				
			})
		
		this.updateData();
		
	}
	
	
	updateData () {
		clearTimeout(this.timerIdBaseData);
		this.getBaseData()
			.then( () => this.analyseBaseData())
			.catch(error => {
				this.log.error('b: ' + error);
			})
		this.timerIdBaseData = setTimeout(this.updateData.bind(this), UPDATE_FREQUENCY_BASEDATA*1000);
	}
	
	async getBaseData() {
	
		// Datenpunkte abfragen und speichern
		try {
			const response = await axios.get('http://' + this.config.ipaddress + ':9006/as/system/information');
		
			if (response.status == 200) {
				this.stateData = response.data;
			} else {
				this.log.error("1. Fehler bei der Verbindung: " + response.status);
			}
			
		} catch (error) {
			if (error.response) { // get response with a status code not in range 2xx
				this.log.error(error.response.data);
				this.log.error(error.response.status);
				this.log.error(error.response.headers);
			} else if (error.request) { // no response
				this.log.error(error.request);
				// instance of XMLHttpRequest in the browser
				// instance ofhttp.ClientRequest in node.js
			} else { // Something wrong in setting up the request
				this.log.error('Error', error.message);
			}
			this.log.error(error.config);
		}
	}
	


	// geladene Daten in Datenpunkte schreiben
	analyseBaseData() {
		
		for (var key in this.stateData) {
			// nur definierte Datenpunkte aktualisieren
			if (key in datapoints) {
				var obj = this.stateData[key];
				this.setStateAsync('status.' + key, {val: obj, ack: true});			
			}
		}
		
		this.setStateAsync("powerOn", {val: ! this.stateData['activeStandby'], ack: true});			
	}
	
	// 
	async getUUID () {
		clearTimeout(this.timerIdUuid);
		
		axios.defaults.headers.common['User-Agent'] = 'SKYPLUS_skyplus' 

		let text = {};

		for( var count = 0; count < 40; count++) {
			try {
				//this.log.debug("UUID call count: " + count);
				text = await axios.get('http://' + this.config.ipaddress + ':49153/description'+count+'.xml');
			} catch (error) {
				continue;
			}
			
			//this.log.debug(text.data);
			
			let words;
			parseString(text.data, function (err, result) {
				var str = result['root']['device'][0]['UDN'][0];
				words = str.split(':');
			});

			//this.log.debug("UUID: " + words[1]);
			this.uuid = words[1];
			break;
		}
		
		this.setStateAsync("status.UUID", {val: this.uuid, ack: true});	
		this.setStateAsync("status.CurrentStation", {val: '-', ack: true});			

		this.timerIdUuid = setTimeout(this.getUUID.bind(this), UPDATE_FREQUENCY_UUID*1000);

	}
	
	
	async getServices () {
		// Datenpunkte abfragen und speichern
		try {
			const response = await axios.get('http://' + this.config.ipaddress + ':9006/as/services');
			this.log.debug("getServices: " + 'http://' + this.config.ipaddress + ':9006/as/services');
			if (response.status == 200) {
				this.serviceData = response.data;
			} else {
				this.log.error("2. Fehler bei der Verbindung: " + response.status);
			}
			
		} catch (error) {
			if (error.response) { // get response with a status code not in range 2xx
				this.log.error("getServices: " + error.response.data);
				this.log.error("getServices: " + error.response.status);
				this.log.error("getServices: " + error.response.headers);
			} else if (error.request) { // no response
				this.log.error("getServices: " + error.request);
				// instance of XMLHttpRequest in the browser
				// instance ofhttp.ClientRequest in node.js
			} else { // Something wrong in setting up the request
				this.log.error("getServices: " + error.message);
			}
			this.log.error("getServices: " + error.config);
		}
	}
	
	// geladene Daten in Datenpunkte schreiben
	analyseServices() {
		
		for (var obj of this.serviceData.services) {
			this.services[obj.sk] = {'name': obj.t, 'format': obj.sf};
		}
		
	}
	
	
	async getCurrentStation() {
		
		clearTimeout(this.timerIdCurrentStation);
			
		var requestBody = '<?xml version="1.0" encoding="utf-8"?>'+
                  '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'+
                  '<s:Body><u:GetMediaInfo xmlns:u="urn:schemas-nds-com:service:SkyPlay:2"><InstanceID>0</InstanceID>'+
                  '</u:GetMediaInfo></s:Body></s:Envelope>';

		var requestHeaders = { 
			'Host': '192.168.2.50:49153',
			'Accept-Encoding': 'gzip,deflate',
			'User-Agent': 'SKYPLUS_skyplus',
			'Content-Type': 'text/xml; charset=utf-8',
			'SOAPACTION': '"urn:schemas-nds-com:service:SkyPlay:2#GetMediaInfo"'    
		};

		var requestOptions = {
		  'method': 'POST',
		  'url': 'http://192.168.2.50:49153/'+ this.uuid +'SkyPlay',
		  'headers': requestHeaders,
		  'body': requestBody,
		  'timeout': 5000
		}; 

		await request(requestOptions, (error, response, body) => {
			if (error) {
				this.log.error(error);
			// handle error
			} else {
				let id = 0;
				try {		
					parseString(body, function (err, result) {
						var str = result['s:Envelope']['s:Body'][0]['u:GetMediaInfoResponse'][0]['CurrentURI'][0];
						var words = str.split('//');
						id = parseInt(words[1], 16);
					});
				} catch (e) {
					this.log.error(e)
				// handle error
				}
				this.CurrentStationId = id;
				this.setState("status.CurrentStation", {val: this.services[id].name, ack: true});			
		   }
		})
		
		this.timerIdCurrentStation = setTimeout(this.getCurrentStation.bind(this), UPDATE_FREQUENCY_CURRENT_STATION*1000);
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Skyq(options);
} else {
	// otherwise start the instance directly
	new Skyq();
}