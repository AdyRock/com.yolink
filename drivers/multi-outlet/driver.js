'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class MultiOutletDriver extends yoLinkDriver
{
	async onInit()
	{
		this.deviceType = 'MultiOutlet';
		this.homey.app.updateLog('MultiOutletDriver has been initialized');
	}

	isSupportedDevice(device)
	{
		return super.isSupportedDevice(device) && device.modelName === 'YS6802-UC';
	}

	getPairingDevicesForDevice(device, UAID)
	{
		const pairedDevice = super.getPairingDevicesForDevice(device, UAID)[0];

		return [0, 1].map((outletIndex) => ({
			...pairedDevice,
			name: `${device.name} - Outlet ${outletIndex + 1}`,
			data: {
				...pairedDevice.data,
				id: `${device.deviceId}-outlet-${outletIndex + 1}`,
				deviceId: device.deviceId,
				outletIndex,
			},
		}));
	}
};
